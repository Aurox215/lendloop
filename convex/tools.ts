import { ConvexError, v } from 'convex/values'
import { query, mutation, type MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { toolCondition } from './schema'
import { requireUser } from './access'
import { TEXT_LIMITS } from '../shared/textLimits'
import { normalizeToolName } from '../shared/toolIdentity'
import { business, businessText, reject, resultValidator } from './business'
import { audit, logged } from './logging'
import { toolAvailability, availabilityStatus } from './availability'

const fields = { name: v.string(), categoryId: v.id('categories'), condition: toolCondition, description: v.string() }
function validateFields(args: { name: string; description: string }) {
  return { name: businessText(args.name, 'Title', TEXT_LIMITS.title), description: businessText(args.description, 'Description', TEXT_LIMITS.description) }
}
async function checkDuplicate(ctx: MutationCtx, ownerId: Id<'users'>, categoryId: Id<'categories'>, name: string, except?: Id<'tools'>) {
  const normalized = normalizeToolName(name)
  // The undefined range protects existing listings until the identity backfill runs.
  for (const key of [normalized, undefined]) {
    for await (const tool of ctx.db.query('tools').withIndex('by_ownerId_and_categoryId_and_normalizedName', q => q.eq('ownerId', ownerId).eq('categoryId', categoryId).eq('normalizedName', key))) {
      if (tool._id !== except && tool.status !== 'removed' && normalizeToolName(tool.name) === normalized) reject('DUPLICATE_TOOL', 'You already have a tool with this name in this category.')
    }
  }
}
export const create = mutation({
  args: { ...fields, clientKey: v.string() }, returns: resultValidator(v.id('tools')),
  handler: (ctx, args) => logged('tool.create', () => business(async () => {
    const user = await requireUser(ctx)
    const text = validateFields(args)
    if (!args.clientKey || args.clientKey.length > 100) reject('INVALID_SUBMISSION', 'Invalid listing submission. Reopen the form.')
    const existing = await ctx.db.query('tools').withIndex('by_ownerId_and_createKey', q => q.eq('ownerId', user._id).eq('createKey', args.clientKey)).unique()
    if (existing) {
      if (normalizeToolName(existing.name) !== normalizeToolName(text.name) || existing.categoryId !== args.categoryId || existing.condition !== args.condition || existing.description !== text.description) reject('SUBMISSION_CONFLICT', 'This submission was already used. Reopen the form.')
      return existing._id
    }
    const category = await ctx.db.get('categories', args.categoryId)
    if (!category?.isActive) reject('CATEGORY_UNAVAILABLE', 'Choose an active category.')
    await checkDuplicate(ctx, user._id, args.categoryId, text.name)
    const id = await ctx.db.insert('tools', { ...text, categoryId: args.categoryId, condition: args.condition, createKey: args.clientKey,
      normalizedName: normalizeToolName(text.name), ownerId: user._id, status: 'active', updatedAt: Date.now() })
    await audit(ctx, user._id, 'tool.created', 'tool', id)
    return id
  })),
})
export const update = mutation({
  args: { toolId: v.id('tools'), ...fields }, returns: resultValidator(v.null()),
  handler: (ctx, { toolId, ...args }) => logged('tool.update', () => business(async () => {
    const user = await requireUser(ctx)
    const tool = await ctx.db.get('tools', toolId)
    if (!tool || tool.ownerId !== user._id || tool.status === 'removed') throw new ConvexError('You can edit only your own listings.')
    const text = validateFields(args)
    const category = await ctx.db.get('categories', args.categoryId)
    if (!category?.isActive) reject('CATEGORY_UNAVAILABLE', 'Choose an active category.')
    await checkDuplicate(ctx, user._id, args.categoryId, text.name, toolId)
    await ctx.db.patch('tools', toolId, { ...args, ...text, normalizedName: normalizeToolName(text.name), updatedAt: Date.now() })
    await audit(ctx, user._id, 'tool.updated', 'tool', toolId)
    return null
  })),
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
  args: { toolId: v.string(), now: v.number() },
  returns: v.union(v.null(), v.object({
    id: v.id('tools'), ...fields, category: v.string(), canEdit: v.boolean(), isOwner: v.boolean(), canBorrow: v.boolean(), availability: availabilityStatus,
  })),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const toolId = ctx.db.normalizeId('tools', args.toolId)
    if (!toolId) return null
    const tool = await ctx.db.get('tools', toolId)
    if (!tool) return null
    const owner = user._id === tool.ownerId
    const role = await ctx.db.get('roles', user.roleId)
    const category = await ctx.db.get('categories', tool.categoryId)
    const availability = await toolAvailability(ctx, tool, !!category?.isActive, args.now)
    const isListed = tool.status === 'active' && category?.isActive
    if (!isListed && !owner && role?.name !== 'admin') {
      const request = await ctx.db.query('borrowRequests').withIndex('by_toolId_and_borrowerId', q => q.eq('toolId', toolId).eq('borrowerId', user._id)).first()
      if (!request) return null
    }
    return {
      id: tool._id, name: tool.name, categoryId: tool.categoryId,
      category: category?.name ?? 'Uncategorized', condition: tool.condition,
      description: tool.description, canEdit: owner && tool.status !== 'removed', isOwner: owner,
      availability, canBorrow: !owner && availability === 'available',
    }
  },
})
