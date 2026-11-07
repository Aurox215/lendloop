import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireAdmin, requireUser } from './access'
import { toolCondition } from './schema'
import { audit, logged } from './logging'
import { activityValidator, latestActivity } from './activity'

const requestRow = v.object({ id: v.id('borrowRequests'), toolId: v.id('tools'), name: v.string(), category: v.string(), description: v.string(), condition: toolCondition, status: v.string(), startAt: v.number(), endAt: v.number(),
  borrowerName: v.union(v.string(), v.null()), loanId: v.union(v.id('loans'), v.null()), loanStatus: v.union(v.string(), v.null()), dueAt: v.union(v.number(), v.null()), activity: activityValidator })
export const requests = query({
  args: { incoming: v.boolean(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(requestRow),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const rows = await (args.incoming
      ? ctx.db.query('borrowRequests').withIndex('by_lenderId_and_startAt', q => q.eq('lenderId', user._id))
      : ctx.db.query('borrowRequests').withIndex('by_borrowerId_and_startAt', q => q.eq('borrowerId', user._id))).order('asc').paginate(args.paginationOpts)
    const page = await Promise.all(rows.page.map(async row => {
      if (row.status !== 'pending' && row.status !== 'approved') return null
      const tool = await ctx.db.get('tools', row.toolId)
      if (!tool) return null
      const category = await ctx.db.get('categories', tool.categoryId)
      const loan = await ctx.db.query('loans').withIndex('by_requestId', q => q.eq('requestId', row._id)).unique()
      if (loan && (loan.status === 'returned' || loan.status === 'cancelled')) return null
      const borrower = args.incoming ? await ctx.db.get('users', row.borrowerId) : null
      return { id: row._id, toolId: tool._id, name: tool.name, category: category?.name ?? '', description: tool.description, condition: tool.condition, status: row.status, startAt: row.startAt, endAt: row.endAt,
        borrowerName: args.incoming ? borrower?.name.trim() || 'Neighbor' : null,
        loanId: loan?._id ?? null, loanStatus: loan?.status ?? null, dueAt: loan?.dueAt ?? null, activity: await latestActivity(ctx, row._id) }
    }))
    return { ...rows, page: page.filter(row => row !== null) }
  },
})

export const removeTool = mutation({
  args: { toolId: v.id('tools') }, returns: v.null(),
  handler: (ctx, args) => logged('tool.remove', async () => {
    const admin = await requireAdmin(ctx)
    const tool = await ctx.db.get('tools', args.toolId)
    if (!tool) throw new ConvexError('Tool not found.')
    if (tool.status !== 'removed') {
      await ctx.db.patch('tools', tool._id, { status: 'removed', removedBy: admin._id, removedAt: Date.now(), updatedAt: Date.now() })
      await audit(ctx, admin._id, 'tool.removed', 'tool', tool._id, { previousStatus: tool.status, status: 'removed' })
    }
    return null
  }),
})

export const loans = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ id: v.id('loans'), toolId: v.id('tools'), name: v.string(), category: v.string(), description: v.string(), condition: toolCondition, status: v.string(), dueAt: v.number(), activity: activityValidator })),
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const rows = await ctx.db.query('loans').withIndex('by_status_and_dueAt').paginate(args.paginationOpts)
    const page = await Promise.all(rows.page.map(async row => {
      const tool = await ctx.db.get('tools', row.toolId)
      if (!tool) return null
      const category = await ctx.db.get('categories', tool.categoryId)
      return { id: row._id, toolId: tool._id, name: tool.name, category: category?.name ?? '', description: tool.description, condition: tool.condition, status: row.status, dueAt: row.dueAt, activity: await latestActivity(ctx, row.requestId) }
    }))
    return { ...rows, page: page.filter(row => row !== null) }
  },
})
