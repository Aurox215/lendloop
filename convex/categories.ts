import { ConvexError, v } from 'convex/values'
import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { mutation, query } from './_generated/server'
import { requireAdmin } from './access'
import { validatedText } from './textValidation'
import { TEXT_LIMITS } from '../shared/textLimits'
import { audit, logged } from './logging'

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ id: v.id('categories'), name: v.string(), isActive: v.boolean() })),
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const result = await ctx.db.query('categories').withIndex('by_isActive_and_sortOrder').order('desc').paginate(args.paginationOpts)
    return { ...result, page: result.page.map(row => ({ id: row._id, name: row.name, isActive: row.isActive })) }
  },
})

export const create = mutation({
  args: { name: v.string() },
  returns: v.id('categories'),
  handler: (ctx, args) => logged('category.create', async () => {
    const actor = await requireAdmin(ctx)
    const name = validatedText(args.name, 'Category', TEXT_LIMITS.category)
    const existing = await ctx.db.query('categories').withIndex('by_name', q => q.eq('name', name)).first()
    if (existing) throw new ConvexError('Category already exists. Restore it if removed.')
    const last = await ctx.db.query('categories').withIndex('by_isActive_and_sortOrder', q => q.eq('isActive', true)).order('desc').first()
    const id = await ctx.db.insert('categories', {
      name, isActive: true, sortOrder: (last?.sortOrder ?? -1) + 1, updatedAt: Date.now(),
    })
    await audit(ctx, actor._id, 'category.created', 'category', id)
    return id
  }),
})

export const update = mutation({
  args: { categoryId: v.id('categories'), name: v.string(), isActive: v.optional(v.boolean()) },
  returns: v.null(),
  handler: (ctx, args) => logged('category.update', async () => {
    const actor = await requireAdmin(ctx)
    const name = validatedText(args.name, 'Category', TEXT_LIMITS.category)
    const previous = await ctx.db.get('categories', args.categoryId)
    if (!previous) throw new ConvexError('Category not found.')
    const duplicate = await ctx.db.query('categories').withIndex('by_name', q => q.eq('name', name)).first()
    if (duplicate && duplicate._id !== args.categoryId) throw new ConvexError('Category already exists.')
    await ctx.db.patch('categories', args.categoryId, { name, ...(args.isActive !== undefined ? { isActive: args.isActive } : {}), updatedAt: Date.now() })
    await audit(ctx, actor._id, 'category.updated', 'category', args.categoryId,
      args.isActive !== undefined ? { previousActive: previous.isActive, isActive: args.isActive } : undefined)
    return null
  }),
})

export const setStatus = mutation({
  args: { categoryId: v.id('categories'), isActive: v.boolean() }, returns: v.null(),
  handler: (ctx, args) => logged('category.status', async () => {
    const actor = await requireAdmin(ctx)
    const category = await ctx.db.get('categories', args.categoryId)
    if (!category) throw new ConvexError('Category not found.')
    if (category.isActive !== args.isActive) {
      await ctx.db.patch('categories', category._id, { isActive: args.isActive, updatedAt: Date.now() })
      await audit(ctx, actor._id, 'category.status_updated', 'category', category._id, { previousActive: category.isActive, isActive: args.isActive })
    }
    return null
  }),
})

export const remove = mutation({
  args: { categoryId: v.id('categories') }, returns: v.null(),
  handler: (ctx, args) => logged('category.remove', async () => {
    const actor = await requireAdmin(ctx)
    const category = await ctx.db.get('categories', args.categoryId)
    if (!category) throw new ConvexError('Category not found.')
    if (category.isActive) {
      await ctx.db.patch('categories', category._id, { isActive: false, updatedAt: Date.now() })
      await audit(ctx, actor._id, 'category.removed', 'category', category._id, { previousActive: true, isActive: false })
    }
    return null
  }),
})
