import type { QueryCtx } from './_generated/server'
import { ConvexError } from 'convex/values'

export async function requireUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new ConvexError('Sign in required.')
  const user = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', identity.tokenIdentifier)).unique()
  if (!user?.isActive) throw new ConvexError('Active account required.')
  return user
}

export async function requireAdmin(ctx: QueryCtx) {
  const user = await requireUser(ctx)
  const role = await ctx.db.get('roles', user.roleId)
  if (role?.name !== 'admin') throw new ConvexError('Admin access required.')
  return user
}
