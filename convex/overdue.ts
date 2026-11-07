import { v } from 'convex/values'
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { enqueue } from './alarms'

// Deadline alerts and the daily n8n workflow share the same loan/UTC-day key.
export async function ensureOverdueEvent(ctx: MutationCtx, loan: Doc<'loans'>, scheduled: boolean) {
  const now = Date.now()
  if (!['active', 'scheduled'].includes(loan.status) || loan.dueAt >= now) return null
  const borrower = await ctx.db.get('users', loan.borrowerId)
  if (!borrower?.isActive) return null
  const tool = await ctx.db.get('tools', loan.toolId)
  const eventId = await enqueue(ctx, {
    idempotencyKey: `overdue:${loan._id}:${new Date(now).toISOString().slice(0, 10)}:${loan.borrowerId}`,
    eventType: 'loan.overdue', kind: 'overdue_reminder',
    recipientId: loan.borrowerId, requestId: loan.requestId, loanId: loan._id,
    title: 'Overdue tool', message: `Please return ${tool?.name ?? 'your borrowed tool'}.`, href: '/my-requests',
  }, scheduled)
  if (loan.overdueAlarmCreatedAt === undefined) await ctx.db.patch('loans', loan._id, { overdueAlarmCreatedAt: now })
  return eventId
}

export const atDue = internalMutation({
  args: { loanId: v.id('loans') }, returns: v.union(v.id('automationEvents'), v.null()),
  handler: async (ctx, args) => {
    const loan = await ctx.db.get('loans', args.loanId)
    if (!loan || loan.overdueAlarmCreatedAt !== undefined) return null
    return ensureOverdueEvent(ctx, loan, true)
  },
})

// Recover missing initial alerts, including legacy loans and edited development due dates.
// Pages continue even when borrowers are inactive, so they cannot starve later loans.
export const recover = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), phase: v.optional(v.union(v.literal('active'), v.literal('scheduled'))) },
  returns: v.object({ checked: v.number(), ensured: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const phase = args.phase ?? 'active'
    const rows = await ctx.db.query('loans').withIndex('by_status_and_overdueAlarmCreatedAt_and_dueAt', q => q.eq('status', phase).eq('overdueAlarmCreatedAt', undefined).lt('dueAt', Date.now()))
      .paginate({ numItems: 25, cursor: args.cursor ?? null })
    let ensured = 0
    for (const loan of rows.page) if (await ensureOverdueEvent(ctx, loan, true)) ensured++
    if (!rows.isDone) await ctx.scheduler.runAfter(0, internal.overdue.recover, { phase, cursor: rows.continueCursor })
    else if (phase === 'active') await ctx.scheduler.runAfter(0, internal.overdue.recover, { phase: 'scheduled', cursor: null })
    return { checked: rows.page.length, ensured, isDone: phase === 'scheduled' && rows.isDone }
  },
})

// Operator verification: inspect persisted initial alarms without exposing identities.
export const inspect = internalQuery({
  args: { now: v.number(), cursor: v.union(v.string(), v.null()), phase: v.union(v.literal('active'), v.literal('scheduled')) },
  returns: v.object({ overdueLoans: v.number(), missingAlarms: v.number(), unreadAlarms: v.number(), cursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('loans').withIndex('by_status_and_dueAt', q => q.eq('status', args.phase).lt('dueAt', args.now)).paginate({ numItems: 25, cursor: args.cursor })
    let missingAlarms = 0, unreadAlarms = 0
    for (const loan of rows.page) {
      if (loan.overdueAlarmCreatedAt === undefined) { missingAlarms++; continue }
      const key = `overdue:${loan._id}:${new Date(loan.overdueAlarmCreatedAt).toISOString().slice(0, 10)}:${loan.borrowerId}`
      const alarm = await ctx.db.query('alarms').withIndex('by_idempotencyKey', q => q.eq('idempotencyKey', `${key}:${loan.borrowerId}`)).unique()
        ?? await ctx.db.query('alarms').withIndex('by_idempotencyKey', q => q.eq('idempotencyKey', key)).unique()
      if (!alarm) missingAlarms++
      else if (alarm.readAt === undefined) unreadAlarms++
    }
    return { overdueLoans: rows.page.length, missingAlarms, unreadAlarms, cursor: rows.continueCursor, isDone: rows.isDone }
  },
})
