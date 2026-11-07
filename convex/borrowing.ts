import { ConvexError, v } from 'convex/values'
import { mutation, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireUser } from './access'
import { enqueue } from './alarms'
import { audit, logged } from './logging'
import { business, reject, resultValidator } from './business'
import { internal } from './_generated/api'

const DAY = 86_400_000

async function assertAvailable(ctx: MutationCtx, toolId: Id<'tools'>, startAt: number, endAt: number) {
  const now = Date.now()
  for (const status of ['active', 'scheduled'] as const) {
    const current = await ctx.db.query('loans').withIndex('by_toolId_and_status_and_startAt', q => q.eq('toolId', toolId).eq('status', status).lte('startAt', now)).first()
    if (current) reject('TOOL_BORROWED', 'This tool is currently borrowed and has not been returned.')
    for await (const loan of ctx.db.query('loans').withIndex('by_toolId_and_status_and_startAt', q => q.eq('toolId', toolId).eq('status', status).lt('startAt', endAt))) {
      if (loan.dueAt > startAt) reject('DATES_UNAVAILABLE', 'This tool is already booked for those dates.')
    }
  }
}

async function notifyRequest(ctx: MutationCtx, request: Doc<'borrowRequests'>, name: string) {
  const created = request.status === 'pending'
  const recipientId = created ? request.lenderId : request.borrowerId
  const dates = `${new Date(request.startAt).toISOString().slice(0, 10)} – ${new Date(request.endAt - DAY).toISOString().slice(0, 10)}`
  await enqueue(ctx, {
    idempotencyKey: `request:${request._id}:${request.statusVersion}`, eventType: created ? 'request.created' : `request.${request.status}`,
    recipientId, requestId: request._id, title: created ? 'New loan request' : `Borrow request ${request.status}`,
    message: `${name} · ${dates}`, href: created ? '/incoming-requests' : '/my-requests',
  })
}

export const create = mutation({
  args: { toolId: v.id('tools'), startAt: v.number(), endAt: v.number(), clientKey: v.string() },
  returns: resultValidator(v.id('borrowRequests')),
  handler: (ctx, args) => logged('request.create', () => business(async () => {
    const borrower = await requireUser(ctx)
    if (!args.clientKey || args.clientKey.length > 100) reject('INVALID_SUBMISSION', 'Invalid request identifier.')
    const existing = await ctx.db.query('borrowRequests').withIndex('by_borrowerId_and_clientKey', q => q.eq('borrowerId', borrower._id).eq('clientKey', args.clientKey)).unique()
    if (existing) {
      if (existing.toolId !== args.toolId || existing.startAt !== args.startAt || existing.endAt !== args.endAt) reject('SUBMISSION_CONFLICT', 'Request identifier already used. Reopen the form.')
      return existing._id
    }
    const { startAt, endAt } = args
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt % DAY || endAt % DAY || startAt < Math.floor(Date.now() / DAY) * DAY || endAt <= startAt || endAt - startAt > 90 * DAY) reject('INVALID_DATES', 'Choose dates from today onward, up to 90 days.')
    const tool = await ctx.db.get('tools', args.toolId)
    if (!tool || tool.status !== 'active') reject('LISTING_UNAVAILABLE', 'This listing is unavailable.')
    if (tool.ownerId === borrower._id) reject('OWN_TOOL', 'You cannot borrow your own tool.')
    const lender = await ctx.db.get('users', tool.ownerId)
    const category = await ctx.db.get('categories', tool.categoryId)
    if (!lender?.isActive || !category?.isActive) reject('LISTING_UNAVAILABLE', 'This listing is unavailable.')
    for await (const pending of ctx.db.query('borrowRequests').withIndex('by_toolId_and_borrowerId_and_startAt', q => q.eq('toolId', tool._id).eq('borrowerId', borrower._id).lt('startAt', endAt))) {
      if (pending.status !== 'pending' || pending.endAt <= startAt) continue
      if (pending.startAt === startAt && pending.endAt === endAt) reject('DUPLICATE_REQUEST', 'You already requested this tool for these dates.')
      reject('PENDING_OVERLAP', 'You already have a pending request for this tool with overlapping dates.')
    }
    await assertAvailable(ctx, tool._id, startAt, endAt)
    const id = await ctx.db.insert('borrowRequests', { ...args, borrowerId: borrower._id, lenderId: tool.ownerId, status: 'pending', statusVersion: 1, updatedAt: Date.now() })
    const request = await ctx.db.get('borrowRequests', id)
    if (!request) throw new Error('Request could not be created.')
    await notifyRequest(ctx, request, tool.name)
    await audit(ctx, borrower._id, 'request.created', 'request', id)
    return id
  })),
})

export const decide = mutation({
  args: { requestId: v.id('borrowRequests'), decision: v.union(v.literal('approved'), v.literal('declined')) }, returns: resultValidator(v.null()),
  handler: (ctx, args) => logged('request.decide', () => business(async () => {
    const lender = await requireUser(ctx)
    const request = await ctx.db.get('borrowRequests', args.requestId)
    if (!request || request.lenderId !== lender._id) throw new ConvexError('Only the lender can decide this request.')
    if (request.status === args.decision) return null
    if (request.status !== 'pending') reject('ALREADY_DECIDED', 'This request has already been decided.')
    const tool = await ctx.db.get('tools', request.toolId)
    if (!tool) reject('LISTING_UNAVAILABLE', 'Tool not found.')
    if (args.decision === 'approved') {
      const borrower = await ctx.db.get('users', request.borrowerId)
      const category = await ctx.db.get('categories', tool.categoryId)
      if (!borrower?.isActive || tool.status !== 'active' || !category?.isActive) reject('LISTING_UNAVAILABLE', 'This request is no longer available.')
      if (request.endAt <= Date.now()) reject('EXPIRED_REQUEST', 'The requested dates have passed.')
      await assertAvailable(ctx, tool._id, request.startAt, request.endAt)
      const loan = await ctx.db.query('loans').withIndex('by_requestId', q => q.eq('requestId', request._id)).unique()
      if (!loan) {
        const loanId = await ctx.db.insert('loans', { requestId: request._id, toolId: tool._id, borrowerId: request.borrowerId, lenderId: lender._id,
          startAt: request.startAt, dueAt: request.endAt, status: 'active', reminderCount: 0, updatedAt: Date.now() })
        await ctx.scheduler.runAt(request.endAt + 1, internal.overdue.atDue, { loanId })
      }
    }
    const changes = { status: args.decision, statusVersion: request.statusVersion + 1, decidedBy: lender._id, decidedAt: Date.now(), updatedAt: Date.now() }
    await ctx.db.patch('borrowRequests', request._id, changes)
    await notifyRequest(ctx, { ...request, ...changes }, tool.name)
    await audit(ctx, lender._id, `request.${args.decision}`, 'request', request._id)
    return null
  })),
})

export const returnLoan = mutation({
  args: { loanId: v.id('loans') }, returns: resultValidator(v.null()),
  handler: (ctx, args) => logged('loan.return', () => business(async () => {
    const owner = await requireUser(ctx)
    const loan = await ctx.db.get('loans', args.loanId)
    if (!loan || loan.lenderId !== owner._id) throw new ConvexError('Only the tool owner can return this loan.')
    if (loan.status === 'returned') return null
    if (loan.status !== 'active') reject('INVALID_LOAN_STATE', 'Only active loans can be returned.')
    const now = Date.now()
    await ctx.db.patch('loans', loan._id, { status: 'returned', returnedAt: now, returnedBy: owner._id, updatedAt: now })
    const tool = await ctx.db.get('tools', loan.toolId)
    await enqueue(ctx, { idempotencyKey: `loan:${loan._id}:returned`, eventType: 'loan.returned', kind: 'request_notification',
      recipientId: loan.borrowerId, requestId: loan.requestId, loanId: loan._id, title: 'Loan returned', message: `${tool?.name ?? 'Tool'} received by the owner.`, href: '/my-requests' })
    await audit(ctx, owner._id, 'loan.returned', 'loan', loan._id)
    return null
  })),
})
