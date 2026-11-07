import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import { dismiss } from './alarms'
import { normalizeToolName } from '../shared/toolIdentity'

// Operator-only, paginated inspection. No identity, contact data, or secrets leave this query.
export const inspectRequests = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ cursor: v.string(), isDone: v.boolean(), requests: v.number(), duplicateEventRows: v.number(), legacyScheduled: v.number() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query('borrowRequests').paginate({ cursor: args.cursor, numItems: 25 })
    let duplicateEventRows = 0, legacyScheduled = 0
    for (const request of page.page) {
      const groups = new Map<string, number>()
      for await (const event of ctx.db.query('automationEvents').withIndex('by_requestId', q => q.eq('requestId', request._id))) {
        if (!event.idempotencyKey.startsWith(`request:${request._id}:`)) continue
        const key = event.idempotencyKey.split(':').slice(0, 3).join(':')
        groups.set(key, (groups.get(key) ?? 0) + 1)
      }
      for (const count of groups.values()) duplicateEventRows += Math.max(0, count - 1)
      for await (const loan of ctx.db.query('loans').withIndex('by_requestId', q => q.eq('requestId', request._id))) if (loan.status === 'scheduled') legacyScheduled++
    }
    return { cursor: page.continueCursor, isDone: page.isDone, requests: page.page.length, duplicateEventRows, legacyScheduled }
  },
})

// Legacy per-recipient outbox rows are consolidated without replaying notifications.
// In-flight groups are left intact until their delivery lease has expired.
export const repairRequests = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ cursor: v.string(), isDone: v.boolean(), removedEvents: v.number(), activatedLoans: v.number(), skippedGroups: v.number() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query('borrowRequests').paginate({ cursor: args.cursor, numItems: 10 })
    let removedEvents = 0, activatedLoans = 0, skippedGroups = 0
    for (const request of page.page) {
      const events = await ctx.db.query('automationEvents').withIndex('by_requestId', q => q.eq('requestId', request._id)).take(100)
      const alarms = await ctx.db.query('alarms').withIndex('by_requestId', q => q.eq('requestId', request._id)).take(200)
      if (events.length === 100 || alarms.length === 200) { skippedGroups++; continue }
      const groups = new Map<string, typeof events>()
      for (const event of events) {
        if (!event.idempotencyKey.startsWith(`request:${request._id}:`)) continue
        const key = event.idempotencyKey.split(':').slice(0, 3).join(':')
        groups.set(key, [...(groups.get(key) ?? []), event])
      }
      for (const [key, group] of groups) {
        if (group.some(row => row.status === 'processing' && (row.nextAttemptAt ?? 0) > Date.now())) { skippedGroups++; continue }
        const created = key.endsWith(':1')
        const recipientId = created ? request.lenderId : request.borrowerId
        const canonical = group.find(row => row.idempotencyKey === key) ?? group.find(row => row.recipientId === recipientId)
        // Unexpected legacy data needs manual inspection; never invent a successful delivery.
        if (!canonical) { skippedGroups++; continue }
        for (const event of group) if (event._id !== canonical._id) { await ctx.db.delete('automationEvents', event._id); removedEvents++ }
        const desiredKey = `${key}:${recipientId}`
        const relevant = alarms.filter(alarm => alarm.idempotencyKey === key || alarm.idempotencyKey.startsWith(`${key}:`))
        const keep = relevant.find(alarm => alarm.recipientId === recipientId && alarm.idempotencyKey === desiredKey) ?? relevant.find(alarm => alarm.recipientId === recipientId)
        for (const alarm of relevant) {
          if (alarm._id === keep?._id) continue
          await dismiss(ctx, alarm)
          await ctx.db.patch('alarms', alarm._id, { idempotencyKey: `legacy:${alarm._id}` })
        }
        if (keep) await ctx.db.patch('alarms', keep._id, { idempotencyKey: desiredKey })
        await ctx.db.patch('automationEvents', canonical._id, { idempotencyKey: key, recipientId, recipients: [recipientId],
          eventType: created ? 'request.created' : (canonical.eventType ?? `request.${request.status}`),
          href: created ? '/incoming-requests' : '/my-requests' })
      }
      for await (const loan of ctx.db.query('loans').withIndex('by_requestId', q => q.eq('requestId', request._id))) {
        if (loan.status === 'scheduled') { await ctx.db.patch('loans', loan._id, { status: 'active', updatedAt: Date.now() }); activatedLoans++ }
      }
    }
    return { cursor: page.continueCursor, isDone: page.isDone, removedEvents, activatedLoans, skippedGroups }
  },
})

export const normalizeTools = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ cursor: v.string(), isDone: v.boolean(), updated: v.number(), duplicateListings: v.number() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query('tools').paginate({ cursor: args.cursor, numItems: 50 })
    let updated = 0, duplicateListings = 0
    for (const tool of page.page) {
      const normalizedName = normalizeToolName(tool.name)
      if (tool.normalizedName !== normalizedName) { await ctx.db.patch('tools', tool._id, { normalizedName }); updated++ }
      if (tool.status === 'removed') continue
      for await (const other of ctx.db.query('tools').withIndex('by_ownerId_and_status', q => q.eq('ownerId', tool.ownerId))) {
        if (other._id < tool._id && other.status !== 'removed' && other.categoryId === tool.categoryId && normalizeToolName(other.name) === normalizedName) duplicateListings++
      }
    }
    // Existing listings are reported, never deleted along with their loan history.
    return { cursor: page.continueCursor, isDone: page.isDone, updated, duplicateListings }
  },
})
