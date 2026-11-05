import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { requireAdmin } from './access'
import { roleName } from './schema'
import { audit, logged } from './logging'

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({
    id: v.id('users'), name: v.string(), email: v.union(v.string(), v.null()),
    role: roleName, trusted: v.boolean(), isActive: v.boolean(), canEdit: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx)
    const result = await ctx.db.query('users').withIndex('by_roleId').paginate(args.paginationOpts)
    const page = await Promise.all(result.page.map(async user => {
      const role = await ctx.db.get('roles', user.roleId)
      return {
        id: user._id, name: user.name, email: user.email ?? null,
        role: role?.name ?? 'user' as const, trusted: user.isTrustedLender,
        isActive: user.isActive, canEdit: user._id !== actor._id,
      }
    }))
    return { ...result, page }
  },
})

export const update = mutation({
  args: { userId: v.id('users'), role: v.optional(roleName), trusted: v.optional(v.boolean()) },
  returns: v.null(),
  handler: (ctx, args) => logged('user.update', async () => {
    const actor = await requireAdmin(ctx)
    if (actor._id === args.userId) throw new ConvexError('You cannot change your own permissions.')
    if (args.role === undefined && args.trusted === undefined) throw new ConvexError('Choose a role or trusted status.')
    const user = await ctx.db.get('users', args.userId)
    if (!user) throw new ConvexError('User not found.')
    const role = args.role
      ? await ctx.db.query('roles').withIndex('by_name', q => q.eq('name', args.role!)).unique()
      : null
    if (args.role && !role) throw new ConvexError('Role is not configured.')
    const roleChanged = role !== null && role._id !== user.roleId
    const trustChanged = args.trusted !== undefined && args.trusted !== user.isTrustedLender
    if (!roleChanged && !trustChanged) return null
    await ctx.db.patch('users', user._id, {
      ...(roleChanged ? { roleId: role._id } : {}),
      ...(trustChanged ? {
        isTrustedLender: args.trusted,
        trustedBy: args.trusted ? actor._id : undefined,
        trustedAt: args.trusted ? Date.now() : undefined,
      } : {}),
      updatedAt: Date.now(),
    })
    const previousRole = await ctx.db.get('roles', user.roleId)
    await audit(ctx, actor._id, 'user.permissions_updated', 'user', user._id, {
      ...(roleChanged ? { previousRole: previousRole?.name ?? 'user', role: role.name } : {}),
      ...(trustChanged ? { previousTrusted: user.isTrustedLender, trusted: args.trusted } : {}),
    })
    return null
  }),
})
