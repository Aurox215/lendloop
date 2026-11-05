import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { v } from 'convex/values'
import { query, type QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { requireAdmin, requireUser } from './access'
import { toolCondition } from './schema'
import { normalizeSearch, searchWeight } from './toolSearch'

const toolRow = v.object({ id: v.id('tools'), name: v.string(), category: v.string(), description: v.string(), condition: toolCondition })
const args = {
  categoryId: v.optional(v.id('categories')), search: v.optional(v.string()),
  now: v.number(), paginationOpts: paginationOptsValidator,
}

export const categories = query({
  args: {}, returns: v.array(v.object({ id: v.id('categories'), name: v.string() })),
  handler: async ctx => {
    const rows = await ctx.db.query('categories').withIndex('by_isActive_and_sortOrder', q => q.eq('isActive', true)).take(100)
    return rows.map(row => ({ id: row._id, name: row.name }))
  },
})

async function available(ctx: QueryCtx, toolId: Id<'tools'>, now: number) {
  const active = await ctx.db.query('loans').withIndex('by_toolId_and_status_and_startAt', q => q.eq('toolId', toolId).eq('status', 'active')).first()
  if (active) return false
  const scheduled = await ctx.db.query('loans').withIndex('by_toolId_and_status_and_startAt', q => q.eq('toolId', toolId).eq('status', 'scheduled').lte('startAt', now)).order('desc').first()
  return !scheduled || scheduled.dueAt <= now
}

async function tools(ctx: QueryCtx, args: { categoryId?: Id<'categories'>; search?: string; now: number; paginationOpts: { numItems: number; cursor: string | null } }, ownerId?: Id<'users'>, onlyAvailable = true) {
  const categoryId = args.categoryId
  const search = normalizeSearch(args.search ?? '')
  let phase = 0
  let cursor = args.paginationOpts.cursor
  if (search && cursor) {
    const parsed: unknown = JSON.parse(cursor)
    if (!Array.isArray(parsed) || parsed.length !== 2 || !Number.isInteger(parsed[0]) || parsed[0] < 0 || parsed[0] > 2 || (parsed[1] !== null && typeof parsed[1] !== 'string')) throw new Error('Invalid search cursor.')
    phase = parsed[0]
    cursor = parsed[1]
  }
  const index = phase === 0 ? 'search_name' : phase === 1 ? 'search_description' : 'search_condition'
  const field = phase === 0 ? 'name' : phase === 1 ? 'description' : 'condition'
  const source = search
    ? ctx.db.query('tools').withSearchIndex(index, q => {
        let range = q.search(field, search)
        if (onlyAvailable) range = range.eq('status', 'active')
        if (categoryId) range = range.eq('categoryId', categoryId)
        if (ownerId) range = range.eq('ownerId', ownerId)
        return range
      })
    : ownerId
      ? ctx.db.query('tools').withIndex('by_ownerId_and_status', q => q.eq('ownerId', ownerId))
      : categoryId
        ? ctx.db.query('tools').withIndex('by_categoryId_and_status', q => onlyAvailable ? q.eq('categoryId', categoryId).eq('status', 'active') : q.eq('categoryId', categoryId))
        : ctx.db.query('tools').withIndex('by_status', q => onlyAvailable ? q.eq('status', 'active') : q)
  // Paginate each priority tier instead of truncating a merged candidate list.
  const result = await source.paginate(search ? { ...args.paginationOpts, cursor } : args.paginationOpts)
  const rows = await Promise.all(result.page.map(async tool => {
    if (tool.status === 'removed' || (categoryId && tool.categoryId !== categoryId)) return null
    if (search && searchWeight(tool, search) !== 3 - phase) return null
    const category = await ctx.db.get('categories', tool.categoryId)
    if (!category || (onlyAvailable && (!category.isActive || !await available(ctx, tool._id, args.now)))) return null
    return { id: tool._id, name: tool.name, category: category.name, description: tool.description, condition: tool.condition }
  }))
  const nextPhase = search && result.isDone && phase < 2
  return {
    page: rows.filter(row => row !== null),
    isDone: result.isDone && !nextPhase,
    continueCursor: search ? JSON.stringify([nextPhase ? phase + 1 : phase, nextPhase ? null : result.continueCursor]) : result.continueCursor,
  }
}

export const publicTools = query({ args, returns: paginationResultValidator(toolRow), handler: (ctx, args) => tools(ctx, args) })
export const myListings = query({
  args, returns: paginationResultValidator(toolRow),
  handler: async (ctx, args) => tools(ctx, args, (await requireUser(ctx))._id, false),
})
export const adminTools = query({
  args, returns: paginationResultValidator(toolRow),
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    return tools(ctx, args, undefined, false)
  },
})
