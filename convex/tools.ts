import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { toolCondition } from './schema'
import { requireUser } from './access'
import { validatedText } from './textValidation'
import { TEXT_LIMITS } from '../shared/textLimits'
import { audit, logged } from './logging'

const fields = {
  name: v.string(), categoryId: v.id('categories'),
  condition: toolCondition, description: v.string(),
}

function validateFields(args: { name: string; description: string }) {
  return {
    name: validatedText(args.name, 'Title', TEXT_LIMITS.title),
    description: validatedText(args.description, 'Description', TEXT_LIMITS.description),
  }
}

export const create = mutation({
  args: fields,
  returns: v.id('tools'),
  handler: (ctx, args) => logged('tool.create', async () => {
    const user = await requireUser(ctx)
    const text = validateFields(args)
    const category = await ctx.db.get('categories', args.categoryId)
    if (!category?.isActive) throw new ConvexError('Choose an active category.')
    const id = await ctx.db.insert('tools', {
      ...args, ...text, ownerId: user._id, status: 'active', updatedAt: Date.now(),
    })
    await audit(ctx, user._id, 'tool.created', 'tool', id)
    return id
  }),
})

export const update = mutation({
  args: { toolId: v.id('tools'), ...fields },
  returns: v.null(),
  handler: (ctx, { toolId, ...args }) => logged('tool.update', async () => {
    const user = await requireUser(ctx)
    const tool = await ctx.db.get('tools', toolId)
    if (!tool || tool.ownerId !== user._id || tool.status === 'removed') {
      throw new ConvexError('You can edit only your own listings.')
    }
    const text = validateFields(args)
    const category = await ctx.db.get('categories', args.categoryId)
    if (!category?.isActive) throw new ConvexError('Choose an active category.')
    await ctx.db.patch('tools', toolId, { ...args, ...text, updatedAt: Date.now() })
    await audit(ctx, user._id, 'tool.updated', 'tool', toolId)
    return null
  }),
})

export const remove = mutation({
  args: { toolId: v.id('tools') }, returns: v.null(),
  handler: (ctx, args) => logged('tool.remove_owned', async () => {
    const actor = await requireUser(ctx)
    const tool = await ctx.db.get('tools', args.toolId)
    if (!tool || tool.ownerId !== actor._id) throw new ConvexError('You can remove only your own listings.')
    if (tool.status !== 'removed') {
      await ctx.db.patch('tools', tool._id, { status: 'removed', removedBy: actor._id, removedAt: Date.now(), updatedAt: Date.now() })
      await audit(ctx, actor._id, 'tool.removed', 'tool', tool._id, { previousStatus: tool.status, status: 'removed' })
    }
    return null
  }),
})

export const detail = query({
  args: { toolId: v.string() },
  returns: v.union(v.null(), v.object({
    id: v.id('tools'), ...fields, category: v.string(), canEdit: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const toolId = ctx.db.normalizeId('tools', args.toolId)
    if (!toolId) return null
    const tool = await ctx.db.get('tools', toolId)
    if (!tool) return null
    const identity = await ctx.auth.getUserIdentity()
    const user = identity
      ? await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', identity.tokenIdentifier)).unique()
      : null
    const activeUser = user?.isActive ? user : null
    const owner = activeUser?._id === tool.ownerId
    const role = activeUser ? await ctx.db.get('roles', activeUser.roleId) : null
    const category = await ctx.db.get('categories', tool.categoryId)
    const isPublic = tool.status === 'active' && category?.isActive
    if (!isPublic && !owner && role?.name !== 'admin') {
      const request = activeUser
        ? await ctx.db.query('borrowRequests').withIndex('by_toolId_and_borrowerId', q => q.eq('toolId', toolId).eq('borrowerId', activeUser._id)).first()
        : null
      if (!request) return null
    }
    return {
      id: tool._id, name: tool.name, categoryId: tool.categoryId,
      category: category?.name ?? 'Uncategorized', condition: tool.condition,
      description: tool.description, canEdit: owner && tool.status !== 'removed',
    }
  },
})
