import { v } from 'convex/values'
import { internalMutation } from './_generated/server'

// Operator-only staged cleanup. Replacing documents preserves IDs and references.
export const removeLegacyFields = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ scanned: v.number(), migrated: v.number(), isDone: v.boolean(), cursor: v.string() }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query('categories').withIndex('by_name').paginate({ numItems: 100, cursor: args.cursor ?? null })
    let migrated = 0
    for (const category of result.page) {
      if ('slug' in category || 'description' in category) {
        await ctx.db.replace('categories', category._id, {
          name: category.name, isActive: category.isActive, sortOrder: category.sortOrder, updatedAt: category.updatedAt,
        })
        migrated++
      }
    }
    console.info(JSON.stringify({ event: 'migration.categories', scanned: result.page.length, migrated, isDone: result.isDone }))
    return { scanned: result.page.length, migrated, isDone: result.isDone, cursor: result.continueCursor }
  },
})
