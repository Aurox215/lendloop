import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { action, internalAction, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { audit, logged } from './logging'

export const viewer = query({
  args: {},
  returns: v.union(v.null(), v.object({ role: v.union(v.literal('admin'), v.literal('user')) })),
  handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null
    const user = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', identity.tokenIdentifier)).unique()
    if (!user?.isActive) return null
    const role = await ctx.db.get('roles', user.roleId)
    return role ? { role: role.name } : null
  },
})

export const ensureUser = mutation({
  args: {}, returns: v.null(),
  handler: ctx => logged('account.initialize', async () => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new ConvexError('Sign in required.')
    const existing = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', identity.tokenIdentifier)).unique()
    if (existing) {
      if (!existing.isActive) throw new ConvexError('Active account required.')
      if (identity.email && identity.email !== existing.email) {
        await ctx.db.patch('users', existing._id, { email: identity.email, updatedAt: Date.now() })
      }
      return null
    }
    let role = await ctx.db.query('roles').withIndex('by_name', q => q.eq('name', 'user')).unique()
    if (!role) {
      const id = await ctx.db.insert('roles', { name: 'user', description: 'Neighborhood member', updatedAt: Date.now() })
      role = await ctx.db.get('roles', id)
    }
    if (!role) throw new ConvexError('User role unavailable.')
    const id = await ctx.db.insert('users', {
      tokenIdentifier: identity.tokenIdentifier, clerkId: identity.subject,
      name: identity.name ?? 'Neighbor', roleId: role._id,
      isTrustedLender: false, isActive: true, updatedAt: Date.now(),
      ...(identity.email ? { email: identity.email } : {}),
    })
    await audit(ctx, id, 'account.created', 'user', id)
    return null
  }),
})

// Fetch the authoritative primary address instead of trusting browser-supplied email.
async function clerkEmail(clerkId: string): Promise<string | null> {
  const secret = process.env.CLERK_SECRET_KEY
  if (!secret) throw new ConvexError('Email sync is not configured. Contact the administrator.')
  let response: Response
  try {
    response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkId)}`, {
      headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new ConvexError('Could not reach Clerk. Try syncing your account again.')
  }
  if (!response.ok) throw new ConvexError('Could not load your Clerk email. Try again.')
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || !('id' in data) || data.id !== clerkId ||
    !('primary_email_address_id' in data) || !('email_addresses' in data) || !Array.isArray(data.email_addresses)) {
    throw new ConvexError('Clerk returned an invalid account response.')
  }
  const primary = data.email_addresses.find((entry: unknown) => entry && typeof entry === 'object' &&
    'id' in entry && entry.id === data.primary_email_address_id)
  return primary && typeof primary.email_address === 'string' ? primary.email_address : null
}

export const storeEmail = internalMutation({
  args: { tokenIdentifier: v.string(), clerkId: v.string(), email: v.union(v.string(), v.null()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', args.tokenIdentifier)).unique()
    if (!user?.isActive || user.clerkId !== args.clerkId) throw new ConvexError('Active account required.')
    if ((user.email ?? null) !== args.email) {
      await ctx.db.patch('users', user._id, { email: args.email ?? undefined, updatedAt: Date.now() })
      await audit(ctx, user._id, 'account.email_synced', 'user', user._id)
    }
    return null
  },
})

export const syncEmail = action({
  args: {}, returns: v.null(),
  handler: ctx => logged('account.email_sync', async () => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new ConvexError('Sign in required.')
    const email = await clerkEmail(identity.subject)
    await ctx.runMutation(internal.accounts.storeEmail, { tokenIdentifier: identity.tokenIdentifier, clerkId: identity.subject, email })
    return null
  }),
})

export const emailBackfillPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ tokenIdentifier: v.string(), clerkId: v.string() })),
  handler: async (ctx, args) => {
    const result = await ctx.db.query('users').withIndex('by_clerkId').paginate(args.paginationOpts)
    return { ...result, page: result.page.filter(user => user.isActive && user.clerkId.startsWith('user_'))
      .map(user => ({ tokenIdentifier: user.tokenIdentifier, clerkId: user.clerkId })) }
  },
})

// Operator-only, bounded backfill for accounts created before email synchronization.
export const backfillEmails = internalAction({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ synced: v.number(), isDone: v.boolean(), cursor: v.string() }),
  handler: (ctx, args): Promise<{ synced: number; isDone: boolean; cursor: string }> => logged('account.email_backfill', async () => {
    const page = await ctx.runQuery(internal.accounts.emailBackfillPage, { paginationOpts: { numItems: 25, cursor: args.cursor ?? null } })
    for (const user of page.page) {
      await ctx.runMutation(internal.accounts.storeEmail, { ...user, email: await clerkEmail(user.clerkId) })
    }
    return { synced: page.page.length, isDone: page.isDone, cursor: page.continueCursor }
  }),
})

