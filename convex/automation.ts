import { v, ConvexError } from 'convex/values'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import { signature } from './integrationAuth'
import { ensureOverdueEvent } from './overdue'

export const payloadValidator = v.object({
  eventId: v.id('automationEvents'), idempotencyKey: v.string(), kind: v.string(),
  title: v.string(), message: v.string(), href: v.string(),
  notifications: v.array(v.object({ recipientKey: v.string(), title: v.string(), message: v.string(), href: v.string() })),
})

async function eventPayload(ctx: QueryCtx, event: Doc<'automationEvents'>) {
  const notifications = []
  for (const [index, recipientId] of (event.recipients ?? [event.recipientId]).entries()) {
    const alarm = await ctx.db.query('alarms').withIndex('by_idempotencyKey', q => q.eq('idempotencyKey', `${event.idempotencyKey}:${recipientId}`)).unique()
    notifications.push({ recipientKey: `${event._id}:${index}`, title: alarm?.title ?? event.title ?? 'Loan update', message: alarm?.message ?? event.message ?? 'Your loan has an update.', href: alarm?.href ?? event.href ?? '/my-requests' })
  }
  return { eventId: event._id, idempotencyKey: event.idempotencyKey, kind: event.kind, title: event.title ?? 'Loan update', message: event.message ?? 'Your loan has an update.', href: event.href ?? '/my-requests', notifications }
}

export const claim = internalMutation({
  args: { eventId: v.id('automationEvents') }, returns: v.union(v.null(), payloadValidator),
  handler: async (ctx, args) => {
    const event = await ctx.db.get('automationEvents', args.eventId)
    const now = Date.now()
    if (!event || event.status === 'sent' || event.status === 'skipped' || (event.nextAttemptAt ?? 0) > now) return null
    if (event.kind === 'overdue_reminder' && event.loanId) {
      const loan = await ctx.db.get('loans', event.loanId)
      if (!loan || (loan.status !== 'active' && loan.status !== 'scheduled') || loan.dueAt >= now) {
        await ctx.db.patch('automationEvents', event._id, { status: 'skipped', nextAttemptAt: undefined, lastError: 'Loan is no longer overdue.', updatedAt: now })
        return null
      }
    }
    if (event.attemptCount >= 6) {
      if (event.status === 'processing') await ctx.db.patch('automationEvents', event._id, { status: 'failed', lastError: 'Delivery lease expired after the final attempt.', nextAttemptAt: undefined, updatedAt: now })
      return null
    }
    await ctx.db.patch('automationEvents', event._id, {
      status: 'processing', attemptCount: event.attemptCount + 1, lastAttemptAt: now, nextAttemptAt: now + 60_000, updatedAt: now,
    })
    return eventPayload(ctx, event)
  },
})

export const fail = internalMutation({
  args: { eventId: v.id('automationEvents'), reason: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get('automationEvents', args.eventId)
    if (!event || event.status === 'sent' || event.status === 'skipped') return null
    const delay = Math.min(3_600_000, 30_000 * 2 ** event.attemptCount)
    await ctx.db.patch('automationEvents', event._id, { status: 'failed', lastError: args.reason,
      nextAttemptAt: event.attemptCount < 6 ? Date.now() + delay : undefined, updatedAt: Date.now() })
    if (event.attemptCount < 6) await ctx.scheduler.runAfter(delay, internal.automation.deliver, { eventId: event._id })
    console.error(JSON.stringify({ event: 'automation.failed', eventId: event._id, attempt: event.attemptCount, reason: args.reason }))
    return null
  },
})

export const complete = internalMutation({
  args: { eventId: v.id('automationEvents'), idempotencyKey: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get('automationEvents', args.eventId)
    if (!event || event.idempotencyKey !== args.idempotencyKey) throw new ConvexError('Invalid notification event.')
    if (event.status === 'sent' || event.status === 'skipped') return null
    const now = Date.now()
    await ctx.db.patch('automationEvents', event._id, { status: 'sent', sentAt: now, lastError: undefined, nextAttemptAt: undefined, updatedAt: now })
    if (event.kind === 'overdue_reminder' && event.loanId) {
      const loan = await ctx.db.get('loans', event.loanId)
      if (loan && (loan.status === 'active' || loan.status === 'scheduled') && loan.dueAt < now) await ctx.db.patch('loans', loan._id, { lastReminderAt: now, reminderCount: loan.reminderCount + 1, updatedAt: now })
    }
    console.info(JSON.stringify({ event: 'automation.sent', eventId: event._id }))
    return null
  },
})

export const deliver = internalAction({
  args: { eventId: v.id('automationEvents') }, returns: v.null(),
  handler: async (ctx, args) => {
    const payload = await ctx.runMutation(internal.automation.claim, args)
    if (!payload) return null
    const url = process.env.N8N_WEBHOOK_URL
    const secret = process.env.AUTOMATION_SHARED_SECRET
    if (!url || !secret) {
      await ctx.runMutation(internal.automation.fail, { ...args, reason: 'n8n integration is not configured.' })
      return null
    }
    try {
      if (!url.startsWith('https://')) throw new Error('Use an HTTPS n8n webhook URL.')
      const body = JSON.stringify(payload)
      const timestamp = String(Math.floor(Date.now() / 1000))
      const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(20_000),
        headers: { 'Content-Type': 'application/json', 'x-lendloop-timestamp': timestamp,
          'x-lendloop-signature': await signature(secret, `${timestamp}.${body}`) },
        body: JSON.stringify({ payload: body }),
      })
      if (!response.ok) throw new Error('Workflow rejected the notification.')
      // Workflow acknowledges only after an idempotent write-back commits.
      const result: unknown = await response.json()
      if (!result || typeof result !== 'object' || !('delivered' in result) || result.delivered !== true) throw new Error('Workflow did not acknowledge delivery.')
      await ctx.runMutation(internal.automation.complete, { eventId: args.eventId, idempotencyKey: payload.idempotencyKey })
    } catch {
      await ctx.runMutation(internal.automation.fail, { ...args, reason: 'n8n notification delivery failed.' })
    }
    return null
  },
})

export const due = internalQuery({
  args: { now: v.number() }, returns: v.array(v.id('automationEvents')),
  handler: async (ctx, args) => {
    const events: Id<'automationEvents'>[] = []
    // Date is supplied by the cron action so this query remains deterministic.
    for (const status of ['pending', 'processing', 'failed'] as const) {
      const rows = await ctx.db.query('automationEvents').withIndex('by_status_and_nextAttemptAt', q => q.eq('status', status).gt('nextAttemptAt', 0).lte('nextAttemptAt', args.now)).take(25)
      events.push(...rows.filter(row => (row.attemptCount < 6 || row.status === 'processing') && row.nextAttemptAt !== undefined).map(row => row._id))
    }
    return events
  },
})

export const retry = internalAction({
  args: {}, returns: v.null(),
  handler: async ctx => {
    const events = await ctx.runQuery(internal.automation.due, { now: Date.now() })
    for (const eventId of events) await ctx.runAction(internal.automation.deliver, { eventId })
    return null
  },
})

export const normalizeEvent = internalQuery({
  args: { eventId: v.string() }, returns: v.union(v.id('automationEvents'), v.null()),
  handler: (ctx, args) => ctx.db.normalizeId('automationEvents', args.eventId),
})

export const requeueFailed = internalMutation({
  args: {}, returns: v.number(),
  handler: async ctx => {
    const rows = await ctx.db.query('automationEvents').withIndex('by_status_and_nextAttemptAt', q => q.eq('status', 'failed')).take(25)
    for (const row of rows) {
      await ctx.db.patch('automationEvents', row._id, { status: 'pending', attemptCount: 0, nextAttemptAt: Date.now(), updatedAt: Date.now() })
      await ctx.scheduler.runAfter(0, internal.automation.deliver, { eventId: row._id })
    }
    return rows.length
  },
})

export const overdue = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ events: v.array(payloadValidator), isDone: v.boolean(), cursor: v.string() }),
  handler: async (ctx, args) => {
    const now = Date.now()
    let phase: 'active' | 'scheduled' = 'active'
    let cursor: string | null = null
    if (args.cursor) {
      const decoded: unknown = JSON.parse(args.cursor)
      if (!decoded || typeof decoded !== 'object' || !('phase' in decoded) || (decoded.phase !== 'active' && decoded.phase !== 'scheduled') || !('cursor' in decoded) || (decoded.cursor !== null && typeof decoded.cursor !== 'string')) throw new ConvexError('Invalid reminder cursor.')
      phase = decoded.phase
      cursor = decoded.cursor
    }
    const rows = await ctx.db.query('loans').withIndex('by_status_and_dueAt', q => q.eq('status', phase).lt('dueAt', now))
      .paginate({ numItems: 25, cursor })
    const events = []
    for (const loan of rows.page) {
      const eventId = await ensureOverdueEvent(ctx, loan, false)
      if (!eventId) continue
      const event = await ctx.db.get('automationEvents', eventId)
      if (event && event.status !== 'sent' && event.status !== 'skipped') events.push(await eventPayload(ctx, event))
    }
    const nextPhase = phase === 'active' && rows.isDone
    return { events, isDone: phase === 'scheduled' && rows.isDone, cursor: JSON.stringify({ phase: nextPhase ? 'scheduled' : phase, cursor: nextPhase ? null : rows.continueCursor }) }
  },
})
