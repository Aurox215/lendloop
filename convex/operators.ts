import { v } from 'convex/values'
import { internalMutation } from './_generated/server'

// Only trusted operators can invoke this via the CLI/dashboard, never clients.
export const grantAdmin = internalMutation({
  args: { clerkId: v.string(), displayName: v.string() },
  returns: v.object({ userId: v.id('users'), role: v.literal('admin') }),
  handler: async (ctx, args) => {
    const user = await ctx.db.query('users').withIndex('by_clerkId', q => q.eq('clerkId', args.clerkId)).unique()
    if (!user?.isActive || !args.clerkId.startsWith('user_')) throw new Error('Active Clerk-linked user not found.')
    const role = await ctx.db.query('roles').withIndex('by_name', q => q.eq('name', 'admin')).unique()
    if (!role) throw new Error('Seed the admin role first.')
    await ctx.db.patch('users', user._id, { roleId: role._id, name: args.displayName, updatedAt: Date.now() })
    return { userId: user._id, role: 'admin' as const }
  },
})
