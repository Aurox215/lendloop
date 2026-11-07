import { v } from 'convex/values'
import type { QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'

export const activityValidator = v.union(v.null(), v.object({ eventType: v.string(), status: v.string(), at: v.number(), error: v.union(v.string(), v.null()) }))
export async function latestActivity(ctx: QueryCtx, requestId: Id<'borrowRequests'>) {
  const event = await ctx.db.query('automationEvents').withIndex('by_requestId', q => q.eq('requestId', requestId)).order('desc').first()
  return event ? { eventType: event.eventType ?? event.kind, status: event.status, at: event.sentAt ?? event.updatedAt, error: event.lastError ?? null } : null
}
