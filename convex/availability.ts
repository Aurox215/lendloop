import { v } from 'convex/values'
import type { QueryCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'

export const availabilityStatus = v.union(v.literal('available'), v.literal('pending'), v.literal('borrowed'), v.literal('overdue'), v.literal('unavailable'))
export async function toolAvailability(ctx: QueryCtx, tool: Doc<'tools'>, categoryActive: boolean, now: number): Promise<'available' | 'pending' | 'borrowed' | 'overdue' | 'unavailable'> {
  const owner = await ctx.db.get('users', tool.ownerId)
  if (tool.status !== 'active' || !categoryActive || !owner?.isActive) return 'unavailable'
  for (const status of ['active', 'scheduled'] as const) {
    const current = await ctx.db.query('loans').withIndex('by_toolId_and_status_and_startAt', q => q.eq('toolId', tool._id).eq('status', status)).first()
    if (current) return current.dueAt < now ? 'overdue' : 'borrowed'
  }
  const pending = await ctx.db.query('borrowRequests').withIndex('by_toolId_and_status_and_endAt', q => q.eq('toolId', tool._id).eq('status', 'pending').gt('endAt', now)).first()
  return pending ? 'pending' : 'available'
}
