import { ConvexError } from 'convex/values'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

export async function logged<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    console.error(JSON.stringify({
      event: 'operation.failed', operation,
      message: error instanceof ConvexError && typeof error.data === 'string' ? error.data : 'Unexpected backend failure',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }))
    // Convex records the original exception/stack; don't swallow failed writes.
    throw error
  }
}

export async function audit(ctx: MutationCtx, actorId: Id<'users'>, action: string, targetType: string, targetId: string, changes?: Doc<'auditLogs'>['changes']) {
  await ctx.db.insert('auditLogs', { actorId, action, targetType, targetId, ...(changes ? { changes } : {}), createdAt: Date.now() })
  console.info(JSON.stringify({ event: 'operation.succeeded', action, actorId, targetType, targetId }))
}
