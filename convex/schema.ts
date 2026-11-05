import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export const roleName = v.union(v.literal('user'), v.literal('admin'))
export const toolCondition = v.union(
  v.literal('new'),
  v.literal('like_new'),
  v.literal('good'),
  v.literal('fair'),
)
export const listingStatus = v.union(
  v.literal('active'),
  v.literal('paused'),
  v.literal('removed'),
)
export const requestStatus = v.union(
  v.literal('pending'),
  v.literal('approved'),
  v.literal('declined'),
  v.literal('cancelled'),
)
export const loanStatus = v.union(
  v.literal('scheduled'),
  v.literal('active'),
  v.literal('returned'),
  v.literal('cancelled'),
)

export default defineSchema({
  auditLogs: defineTable({
    actorId: v.id('users'),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    changes: v.optional(v.object({
      previousRole: v.optional(roleName), role: v.optional(roleName),
      previousTrusted: v.optional(v.boolean()), trusted: v.optional(v.boolean()),
      previousActive: v.optional(v.boolean()), isActive: v.optional(v.boolean()),
      previousStatus: v.optional(listingStatus), status: v.optional(listingStatus),
    })),
    createdAt: v.number(),
  }).index('by_createdAt', ['createdAt']),

  roles: defineTable({
    name: roleName,
    description: v.string(),
    updatedAt: v.number(),
  }).index('by_name', ['name']),

  users: defineTable({
    // Canonical identity from ctx.auth; Clerk remains the authentication source.
    tokenIdentifier: v.string(),
    clerkId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    roleId: v.id('roles'),
    isTrustedLender: v.boolean(),
    trustedBy: v.optional(v.id('users')),
    trustedAt: v.optional(v.number()),
    isActive: v.boolean(),
    updatedAt: v.number(),
  })
    .index('by_tokenIdentifier', ['tokenIdentifier'])
    .index('by_clerkId', ['clerkId'])
    .index('by_roleId', ['roleId']),

  categories: defineTable({
    name: v.string(),
    isActive: v.boolean(),
    sortOrder: v.number(),
    updatedAt: v.number(),
  })
    .index('by_name', ['name'])
    .index('by_isActive_and_sortOrder', ['isActive', 'sortOrder']),

  tools: defineTable({
    ownerId: v.id('users'),
    categoryId: v.id('categories'),
    name: v.string(),
    condition: toolCondition,
    description: v.string(),
    // Listing visibility is separate from date-dependent loan availability.
    status: listingStatus,
    removedBy: v.optional(v.id('users')),
    removedAt: v.optional(v.number()),
    removalReason: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('by_ownerId_and_status', ['ownerId', 'status'])
    .index('by_status', ['status'])
    .searchIndex('search_name', { searchField: 'name', filterFields: ['status', 'categoryId', 'ownerId'] })
    .searchIndex('search_description', { searchField: 'description', filterFields: ['status', 'categoryId', 'ownerId'] })
    .searchIndex('search_condition', { searchField: 'condition', filterFields: ['status', 'categoryId', 'ownerId'] })
    .index('by_categoryId_and_status', ['categoryId', 'status']),

  borrowRequests: defineTable({
    toolId: v.id('tools'),
    borrowerId: v.id('users'),
    // Snapshot of the owner at request creation, assigned by the backend.
    lenderId: v.id('users'),
    startAt: v.number(),
    endAt: v.number(),
    message: v.optional(v.string()),
    status: requestStatus,
    // Increment on status changes to identify distinct notification events.
    statusVersion: v.number(),
    decidedBy: v.optional(v.id('users')),
    decidedAt: v.optional(v.number()),
    decisionNote: v.optional(v.string()),
    cancelledBy: v.optional(v.id('users')),
    cancelledAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_borrowerId_and_status', ['borrowerId', 'status'])
    .index('by_toolId_and_borrowerId', ['toolId', 'borrowerId'])
    .index('by_lenderId_and_status', ['lenderId', 'status'])
    .index('by_toolId_and_status_and_startAt', ['toolId', 'status', 'startAt']),

  loans: defineTable({
    requestId: v.id('borrowRequests'),
    toolId: v.id('tools'),
    borrowerId: v.id('users'),
    lenderId: v.id('users'),
    startAt: v.number(),
    dueAt: v.number(),
    status: loanStatus,
    handedOverAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    returnedBy: v.optional(v.id('users')),
    returnNote: v.optional(v.string()),
    cancelledAt: v.optional(v.number()),
    cancelledBy: v.optional(v.id('users')),
    lastReminderAt: v.optional(v.number()),
    reminderCount: v.number(),
    updatedAt: v.number(),
  })
    .index('by_requestId', ['requestId'])
    .index('by_borrowerId_and_status', ['borrowerId', 'status'])
    .index('by_lenderId_and_status', ['lenderId', 'status'])
    .index('by_toolId_and_status_and_startAt', ['toolId', 'status', 'startAt'])
    .index('by_status_and_dueAt', ['status', 'dueAt']),

  // One row per logical notification, with retries updating the same row.
  automationEvents: defineTable({
    idempotencyKey: v.string(),
    kind: v.union(v.literal('request_notification'), v.literal('overdue_reminder')),
    requestId: v.id('borrowRequests'),
    loanId: v.optional(v.id('loans')),
    recipientId: v.id('users'),
    status: v.union(
      v.literal('pending'),
      v.literal('processing'),
      v.literal('sent'),
      v.literal('failed'),
    ),
    attemptCount: v.number(),
    nextAttemptAt: v.optional(v.number()),
    lastAttemptAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    workflowExecutionId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('by_idempotencyKey', ['idempotencyKey'])
    .index('by_loanId', ['loanId'])
    .index('by_requestId', ['requestId'])
    .index('by_status_and_nextAttemptAt', ['status', 'nextAttemptAt']),
})
