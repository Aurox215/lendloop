import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { requireUser } from './access'

type Notice = {
  idempotencyKey: string; recipientId: Id<'users'>; requestId: Id<'borrowRequests'>
  loanId?: Id<'loans'>; title: string; message: string; href: string
  eventType?: string; kind?: 'request_notification' | 'overdue_reminder'
}

async function countUnread(ctx: QueryCtx, user: Doc<'users'>) {
  if (user.unreadAlarmCount !== undefined) return user.unreadAlarmCount
  let count = 0
  for await (const alarm of ctx.db.query('alarms').withIndex('by_recipientId_and_readAt_and_createdAt', q => q.eq('recipientId', user._id).eq('readAt', undefined))) { if (alarm) count++ }
  return count
}

// Durable in-app alarms and the delivery outbox commit with the business change.
export async function enqueue(ctx: MutationCtx, notice: Notice, scheduled = true, additional: Notice[] = []) {
  if (additional.length > 9) throw new Error('Too many notification recipients.')
  const existing = await ctx.db.query('automationEvents').withIndex('by_idempotencyKey', q => q.eq('idempotencyKey', notice.idempotencyKey)).unique()
  if (existing) return existing._id
  const now = Date.now()
  const { eventType, kind, ...primary } = notice
  const recipients = new Set<Id<'users'>>()
  for (const item of [notice, ...additional]) {
    if (recipients.has(item.recipientId)) continue
    recipients.add(item.recipientId)
    const user = await ctx.db.get('users', item.recipientId)
    if (!user) throw new ConvexError('Alarm recipient not found.')
    const unread = await countUnread(ctx, user)
    await ctx.db.insert('alarms', { recipientId: item.recipientId, requestId: item.requestId, loanId: item.loanId,
      title: item.title, message: item.message, href: item.href, idempotencyKey: `${notice.idempotencyKey}:${item.recipientId}`, createdAt: now })
    await ctx.db.patch('users', user._id, { unreadAlarmCount: unread + 1 })
  }
  const eventId = await ctx.db.insert('automationEvents', {
    ...primary, eventType, recipients: [...recipients], kind: kind ?? (notice.loanId ? 'overdue_reminder' : 'request_notification'),
    status: 'pending', attemptCount: 0, nextAttemptAt: now, updatedAt: now,
  })
  if (scheduled) await ctx.scheduler.runAfter(0, internal.automation.deliver, { eventId })
  return eventId
}

export const list = query({
  args: {},
  returns: v.array(v.object({ id: v.id('alarms'), title: v.string(), message: v.string(), href: v.string(), createdAt: v.number(), unread: v.boolean() })),
  handler: async ctx => {
    const user = await requireUser(ctx)
    const rows = await ctx.db.query('alarms').withIndex('by_recipientId_and_dismissedAt_and_createdAt', q => q.eq('recipientId', user._id).eq('dismissedAt', undefined)).order('desc').take(5)
    return rows.map(row => ({ id: row._id, title: row.title, message: row.message, href: row.href, createdAt: row.createdAt, unread: row.readAt === undefined }))
  },
})

export const unreadCount = query({
  args: {}, returns: v.number(),
  handler: async ctx => countUnread(ctx, await requireUser(ctx)),
})

export const markRead = mutation({
  args: { alarmId: v.id('alarms') }, returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const alarm = await ctx.db.get('alarms', args.alarmId)
    if (!alarm || alarm.recipientId !== user._id) throw new ConvexError('Alarm not found.')
    await markAlarmRead(ctx, alarm)
    return null
  },
})

export async function dismiss(ctx: MutationCtx, alarm: Doc<'alarms'>) {
  if (alarm.dismissedAt !== undefined) return
  const user = await ctx.db.get('users', alarm.recipientId)
  if (!user) return
  const unread = await countUnread(ctx, user)
  await ctx.db.patch('alarms', alarm._id, { readAt: alarm.readAt ?? Date.now(), dismissedAt: Date.now() })
  if (alarm.readAt === undefined) await ctx.db.patch('users', user._id, { unreadAlarmCount: Math.max(0, unread - 1) })
}

// Reading changes only read state/counters. It never removes an alarm from history.
async function markAlarmRead(ctx: MutationCtx, alarm: Doc<'alarms'>) {
  if (alarm.readAt !== undefined) return
  const user = await ctx.db.get('users', alarm.recipientId)
  if (!user) return
  const unread = await countUnread(ctx, user)
  await ctx.db.patch('alarms', alarm._id, { readAt: Date.now() })
  await ctx.db.patch('users', user._id, { unreadAlarmCount: Math.max(0, unread - 1) })
}

export const consumeRequests = mutation({
  args: { requestIds: v.array(v.id('borrowRequests')), incoming: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (args.requestIds.length > 100) throw new ConvexError('Too many requests.')
    for (const requestId of new Set(args.requestIds)) {
      const request = await ctx.db.get('borrowRequests', requestId)
      if (!request || (args.incoming ? request.lenderId : request.borrowerId) !== user._id) throw new ConvexError('This request is not yours.')
      for await (const alarm of ctx.db.query('alarms').withIndex('by_requestId', q => q.eq('requestId', requestId))) {
        if (alarm.recipientId === user._id) await markAlarmRead(ctx, alarm)
      }
    }
    return null
  },
})

async function readBatch(ctx: MutationCtx, userId: Id<'users'>, cutoff: number) {
  const user = await ctx.db.get('users', userId)
  if (!user?.isActive) return
  const rows = await ctx.db.query('alarms').withIndex('by_recipientId_and_readAt_and_createdAt', q => q.eq('recipientId', userId).eq('readAt', undefined).lte('createdAt', cutoff)).take(100)
  const unread = await countUnread(ctx, user)
  for (const alarm of rows) await ctx.db.patch('alarms', alarm._id, { readAt: Date.now() })
  await ctx.db.patch('users', userId, { unreadAlarmCount: Math.max(0, unread - rows.length) })
  if (rows.length === 100) await ctx.scheduler.runAfter(0, internal.alarms.readOlder, { userId, cutoff })
}

export const markAllRead = mutation({
  args: {}, returns: v.null(),
  handler: async ctx => { await readBatch(ctx, (await requireUser(ctx))._id, Date.now()); return null },
})

export const readOlder = internalMutation({
  args: { userId: v.id('users'), cutoff: v.number() }, returns: v.null(),
  handler: async (ctx, args) => { await readBatch(ctx, args.userId, args.cutoff); return null },
})

export const backfillCounts = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ updated: v.number(), isDone: v.boolean(), cursor: v.string() }),
  handler: async (ctx, args) => {
    const users = await ctx.db.query('users').withIndex('by_clerkId').paginate({ numItems: 25, cursor: args.cursor ?? null })
    for (const user of users.page) {
      let count = 0
      for await (const alarm of ctx.db.query('alarms').withIndex('by_recipientId_and_readAt_and_createdAt', q => q.eq('recipientId', user._id).eq('readAt', undefined))) { if (alarm) count++ }
      await ctx.db.patch('users', user._id, { unreadAlarmCount: count })
    }
    return { updated: users.page.length, isDone: users.isDone, cursor: users.continueCursor }
  },
})

export const restoreReadHistory = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ restored: v.number(), isDone: v.boolean(), cursor: v.string() }),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('alarms').paginate({ numItems: 50, cursor: args.cursor })
    let restored = 0
    for (const alarm of rows.page) {
      // Suppressed legacy duplicate echoes remain hidden. Valid read alarms are restored.
      if (alarm.dismissedAt === undefined || alarm.idempotencyKey.startsWith('legacy:')) continue
      await markAlarmRead(ctx, alarm)
      await ctx.db.patch('alarms', alarm._id, { dismissedAt: undefined })
      restored++
    }
    return { restored, isDone: rows.isDone, cursor: rows.continueCursor }
  },
})
