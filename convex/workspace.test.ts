/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import type { FunctionReturnType } from 'convex/server'
import { describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import schema from './schema'
import type { BusinessResult } from '../shared/result'
import { TEXT_LIMITS, textError } from '../shared/textLimits'

// Unwrap successful results in existing behavior tests; validation tests assert raw results.
async function value<T>(promise: Promise<BusinessResult<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new Error(result.message)
  return result.value
}

const modules = import.meta.glob('./**/*.ts')
const now = 1_800_000_000_000
const paginationOpts = { numItems: 12, cursor: null }

describe('Clerk email synchronization', () => {
  test('updates an existing account from signed claims without changing privileges', async () => {
    const { t, ids } = await fixture()
    const actor = t.withIdentity({ tokenIdentifier: 'test|admin', subject: 'admin', email: 'admin@example.invalid' })
    await actor.mutation(api.accounts.ensureUser, {})
    const user = await t.run(ctx => ctx.db.get('users', ids.admin))
    expect(user?.email).toBe('admin@example.invalid')
    expect(user?.isTrustedLender).toBe(false)
    expect((await actor.query(api.accounts.viewer, {}))?.role).toBe('admin')
  })

  test('syncs only the caller from Clerk even when the JWT has no email', async () => {
    const { t, ids, user } = await fixture()
    vi.stubEnv('CLERK_SECRET_KEY', 'test-server-key')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'user', primary_email_address_id: 'primary', email_addresses: [
        { id: 'secondary', email_address: 'secondary@example.invalid' },
        { id: 'primary', email_address: 'primary@example.invalid' },
      ],
    })))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(t.action(api.accounts.syncEmail, {})).rejects.toThrow('Sign in required.')
      expect(fetchMock).not.toHaveBeenCalled()
      await user.action(api.accounts.syncEmail, {})
      expect((await t.run(ctx => ctx.db.get('users', ids.user)))?.email).toBe('primary@example.invalid')
      expect((await t.run(ctx => ctx.db.get('users', ids.other)))?.email).toBeUndefined()
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.clerk.com/v1/users/user')
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs() }
  })

  test('Clerk failures preserve the stored email and remain visible', async () => {
    const { t, ids, user } = await fixture()
    await t.run(ctx => ctx.db.patch('users', ids.user, { email: 'existing@example.invalid' }))
    vi.stubEnv('CLERK_SECRET_KEY', 'test-server-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    try {
      await expect(user.action(api.accounts.syncEmail, {})).rejects.toThrow('Could not load your Clerk email.')
      expect((await t.run(ctx => ctx.db.get('users', ids.user)))?.email).toBe('existing@example.invalid')
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs() }
  })
})

async function fixture() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    const userRole = await ctx.db.insert('roles', { name: 'user', description: '', updatedAt: now })
    const adminRole = await ctx.db.insert('roles', { name: 'admin', description: '', updatedAt: now })
    const user = await ctx.db.insert('users', { tokenIdentifier: 'test|user', clerkId: 'user', name: 'User', roleId: userRole, isActive: true, isTrustedLender: false, updatedAt: now })
    const other = await ctx.db.insert('users', { tokenIdentifier: 'test|other', clerkId: 'other', name: 'Other', roleId: userRole, isActive: true, isTrustedLender: false, updatedAt: now })
    const admin = await ctx.db.insert('users', { tokenIdentifier: 'test|admin', clerkId: 'admin', name: 'Admin', roleId: adminRole, isActive: true, isTrustedLender: false, updatedAt: now })
    const category = await ctx.db.insert('categories', { name: 'Power Tools', sortOrder: 0, isActive: true, updatedAt: now })
    const tools = []
    for (let i = 0; i < 16; i++) tools.push(await ctx.db.insert('tools', { ownerId: user, categoryId: category, name: `Drill ${i}`, description: 'Private description', condition: 'good', status: 'active', updatedAt: now }))
    const otherTool = await ctx.db.insert('tools', { ownerId: other, categoryId: category, name: 'Sander', description: '', condition: 'good', status: 'active', updatedAt: now })
    const request = await ctx.db.insert('borrowRequests', { toolId: tools[0], borrowerId: other, lenderId: user, startAt: now - 1000, endAt: now + 1000, status: 'approved', statusVersion: 1, updatedAt: now })
    const loan = await ctx.db.insert('loans', { toolId: tools[0], borrowerId: other, lenderId: user, requestId: request, startAt: now - 1000, dueAt: now + 1000, status: 'active', reminderCount: 0, updatedAt: now })
    return { user, other, admin, category, tools, otherTool, request, loan }
  })
  return { t, ids, user: t.withIdentity({ tokenIdentifier: 'test|user', subject: 'user' }), other: t.withIdentity({ tokenIdentifier: 'test|other', subject: 'other' }), admin: t.withIdentity({ tokenIdentifier: 'test|admin', subject: 'admin' }) }
}

describe('Dashboard', () => {
  test('paginates without duplicates and returns only public fields', async () => {
    const { t, ids } = await fixture()
    let cursor: string | null = null
    const all = []
    for (;;) {
      const result: FunctionReturnType<typeof api.catalog.publicTools> = await t.query(api.catalog.publicTools, { now, paginationOpts: { numItems: 12, cursor } })
      expect(result.page.length).toBeLessThanOrEqual(12)
      all.push(...result.page)
      if (result.isDone) break
      cursor = result.continueCursor
    }
    expect(all).toHaveLength(16)
    expect(new Set(all.map(row => row.id)).size).toBe(all.length)
    expect(all.some(row => row.id === ids.tools[0])).toBe(false)
    for (const row of all) expect(Object.keys(row).sort()).toEqual(['category', 'id', 'name'])
  })

  test('search and category filters apply before pagination', async () => {
    const { t, ids } = await fixture()
    const result = await t.query(api.catalog.publicTools, { search: 'Sander', categoryId: ids.category, now, paginationOpts })
    expect(result.page.map(row => row.name)).toEqual(['Sander'])
  })

  test('ranks name before description before condition across pages without duplicates', async () => {
    const { t, ids } = await fixture()
    await t.run(async ctx => {
      await ctx.db.patch('tools', ids.otherTool, { name: 'Good sander', description: 'Good condition' })
      await ctx.db.patch('tools', ids.tools[1], { description: 'Good for repairs' })
    })
    const all = []
    let cursor: string | null = null
    for (;;) {
      const result: FunctionReturnType<typeof api.catalog.publicTools> = await t.query(api.catalog.publicTools, { search: 'good', now, paginationOpts: { numItems: 1, cursor } })
      all.push(...result.page)
      if (result.isDone) break
      cursor = result.continueCursor
    }
    expect(all).toHaveLength(16)
    expect(all[0].id).toBe(ids.otherTool)
    expect(all[1].id).toBe(ids.tools[1])
    expect(new Set(all.map(row => row.id)).size).toBe(16)
  })

  test('finds human-readable conditions and descriptions, including in request views', async () => {
    const { t, user, admin, ids } = await fixture()
    await t.run(ctx => ctx.db.patch('tools', ids.otherTool, { condition: 'like_new' }))
    const all = []
    let cursor: string | null = null
    for (;;) {
      const result: FunctionReturnType<typeof api.catalog.publicTools> = await t.query(api.catalog.publicTools, { search: 'like new', now, paginationOpts: { ...paginationOpts, cursor } })
      all.push(...result.page)
      if (result.isDone) break
      cursor = result.continueCursor
    }
    expect(all.map(row => row.id)).toEqual([ids.otherTool])
    expect((await user.query(api.workspace.requests, { incoming: true, paginationOpts })).page.map(row => row.id)).toEqual([ids.request])
    expect((await admin.query(api.workspace.loans, { paginationOpts })).page.map(row => row.id)).toEqual([ids.loan])
  })

  test('unreturned reservations stay off the public available catalog; returns release tools', async () => {
    const { t, ids } = await fixture()
    await t.run(ctx => ctx.db.patch('loans', ids.loan, { status: 'scheduled' }))
    const current = await t.query(api.catalog.publicTools, { search: 'Drill 0', now, paginationOpts })
    expect(current.page.some(row => row.id === ids.tools[0])).toBe(false)
    const future = await t.query(api.catalog.publicTools, { search: 'Drill 0', now: now - 2000, paginationOpts })
    expect(future.page.some(row => row.id === ids.tools[0])).toBe(false)
    await t.run(ctx => ctx.db.patch('loans', ids.loan, { status: 'returned' }))
    const returned = await t.query(api.catalog.publicTools, { search: 'Drill 0', now, paginationOpts })
    expect(returned.page.some(row => row.id === ids.tools[0])).toBe(true)
  })

  test('paused, removed, and inactive-category listings stay off the dashboard', async () => {
    const { t, ids } = await fixture()
    await t.run(async ctx => {
      await ctx.db.patch('tools', ids.otherTool, { status: 'paused' })
      await ctx.db.patch('tools', ids.tools[1], { status: 'removed' })
    })
    const result = await t.query(api.catalog.publicTools, { now, paginationOpts })
    expect(result.page.some(row => row.id === ids.otherTool || row.id === ids.tools[1])).toBe(false)
    await t.run(ctx => ctx.db.patch('categories', ids.category, { isActive: false }))
    expect((await t.query(api.catalog.publicTools, { now, paginationOpts })).page).toEqual([])
  })
})

describe('Ownership and roles', () => {
  test('anonymous callers cannot read personal/admin views or mutate admin data', async () => {
    const { t, ids } = await fixture()
    await expect(t.query(api.catalog.myListings, { now, paginationOpts })).rejects.toThrow('Sign in required')
    await expect(t.query(api.workspace.requests, { incoming: false, paginationOpts })).rejects.toThrow('Sign in required')
    await expect(t.query(api.workspace.loans, { paginationOpts })).rejects.toThrow('Sign in required')
    await expect(t.query(api.adminUsers.list, { paginationOpts })).rejects.toThrow('Sign in required')
    await expect(t.mutation(api.workspace.removeTool, { toolId: ids.otherTool })).rejects.toThrow('Sign in required')
    await expect(t.mutation(api.adminUsers.update, { userId: ids.other, trusted: true })).rejects.toThrow('Sign in required')
  })

  test('standard users cannot call admin functions', async () => {
    const { user, ids } = await fixture()
    await expect(user.query(api.catalog.adminTools, { now, paginationOpts })).rejects.toThrow('Admin access required')
    await expect(user.query(api.workspace.loans, { paginationOpts })).rejects.toThrow('Admin access required')
    await expect(user.query(api.adminUsers.list, { paginationOpts })).rejects.toThrow('Admin access required')
    await expect(user.mutation(api.workspace.removeTool, { toolId: ids.otherTool })).rejects.toThrow('Admin access required')
    await expect(user.mutation(api.adminUsers.update, { userId: ids.other, trusted: true })).rejects.toThrow('Admin access required')
  })

  test('personal views enforce the current identity', async () => {
    const { user, other, ids } = await fixture()
    const mine = await other.query(api.catalog.myListings, { now, paginationOpts })
    expect(mine.page.map(row => row.id)).toEqual([ids.otherTool])
    expect((await user.query(api.workspace.requests, { incoming: false, paginationOpts })).page).toEqual([])
    expect((await user.query(api.workspace.requests, { incoming: true, paginationOpts })).page.map(row => row.id)).toEqual([ids.request])
    expect((await other.query(api.workspace.requests, { incoming: false, paginationOpts })).page.map(row => row.id)).toEqual([ids.request])
  })

  test('disabled admins lose access', async () => {
    const { t, admin, ids } = await fixture()
    await t.run(ctx => ctx.db.patch('users', ids.admin, { isActive: false }))
    await expect(admin.query(api.workspace.loans, { paginationOpts })).rejects.toThrow('Active account required')
    await expect(admin.mutation(api.adminUsers.update, { userId: ids.other, trusted: true })).rejects.toThrow('Active account required')
  })

  test('owners and admins can find paused listings without exposing them publicly', async () => {
    const { t, other, admin, ids } = await fixture()
    await t.run(ctx => ctx.db.patch('tools', ids.otherTool, { status: 'paused' }))
    expect((await other.query(api.catalog.myListings, { search: 'Sander', now, paginationOpts })).page.map(row => row.id)).toEqual([ids.otherTool])
    expect((await admin.query(api.catalog.adminTools, { search: 'Sander', now, paginationOpts })).page.map(row => row.id)).toEqual([ids.otherTool])
    expect((await t.query(api.catalog.publicTools, { search: 'Sander', now, paginationOpts })).page).toEqual([])
  })

  test('admin can soft-remove any listing and trust a lender idempotently', async () => {
    const { t, admin, ids } = await fixture()
    await admin.mutation(api.adminUsers.update, { userId: ids.other, trusted: true })
    await admin.mutation(api.adminUsers.update, { userId: ids.other, trusted: true })
    const trusted = await t.run(ctx => ctx.db.get('users', ids.other))
    expect(trusted?.isTrustedLender).toBe(true)
    expect(trusted?.trustedBy).toBe(ids.admin)
    await admin.mutation(api.workspace.removeTool, { toolId: ids.otherTool })
    await admin.mutation(api.workspace.removeTool, { toolId: ids.otherTool })
    const removed = await t.run(ctx => ctx.db.get('tools', ids.otherTool))
    expect(removed?.status).toBe('removed')
    expect(removed?.removedBy).toBe(ids.admin)
    expect((await admin.query(api.workspace.loans, { paginationOpts })).page.map(row => row.id)).toEqual([ids.loan])
  })

  test('new Clerk users receive the user role and existing roles are preserved', async () => {
    const { t, admin } = await fixture()
    const newUser = t.withIdentity({ tokenIdentifier: 'test|new', subject: 'new', name: 'New Neighbor' })
    await newUser.mutation(api.accounts.ensureUser, {})
    await newUser.mutation(api.accounts.ensureUser, {})
    expect(await newUser.query(api.accounts.viewer, {})).toEqual({ role: 'user' })
    await admin.mutation(api.accounts.ensureUser, {})
    expect(await admin.query(api.accounts.viewer, {})).toEqual({ role: 'admin' })
  })
})

describe('Text limits and full-text access', () => {
  test('accepts boundary values and rejects oversized text on create and update', async () => {
    const { user, ids } = await fixture()
    const fields = {
      name: 'T'.repeat(TEXT_LIMITS.title), description: 'D'.repeat(TEXT_LIMITS.description),
      condition: 'good' as const, categoryId: ids.category,
    }
    const toolId = await value(user.mutation(api.tools.create, { ...fields, clientKey: 'unit-15321' }))
    await value(user.mutation(api.tools.update, { toolId, ...fields }))
    const detail = await user.query(api.tools.detail, { now: Date.now(), toolId })
    expect(detail?.name).toBe(fields.name)
    expect(detail?.description).toBe(fields.description)
    for (const invalid of [{ ...fields, name: `${fields.name}x` }, { ...fields, description: `${fields.description}x` }]) {
      await expect(value(user.mutation(api.tools.create, { ...invalid, clientKey: 'unit-15736' }))).rejects.toThrow('characters or fewer')
      await expect(value(user.mutation(api.tools.update, { toolId, ...invalid }))).rejects.toThrow('characters or fewer')
    }
    await expect(value(user.mutation(api.tools.create, { clientKey: 'unit-15955', ...fields, name: '   ' }))).rejects.toThrow('Title is required')
    await expect(value(user.mutation(api.tools.update, { toolId, ...fields, description: '\n ' }))).rejects.toThrow('Description is required')
  })

  test('category mutations enforce forty characters and admin access', async () => {
    const { admin, user, ids } = await fixture()
    const name = 'C'.repeat(TEXT_LIMITS.category)
    const categoryId = await admin.mutation(api.categories.create, { name })
    await admin.mutation(api.categories.update, { categoryId, name })
    await expect(admin.mutation(api.categories.create, { name: `${name}x` })).rejects.toThrow('40 characters or fewer')
    await expect(admin.mutation(api.categories.update, { categoryId, name: `${name}x` })).rejects.toThrow('40 characters or fewer')
    await expect(user.mutation(api.categories.create, { name: 'Category' })).rejects.toThrow('Admin access required')
    await expect(user.mutation(api.categories.update, { categoryId: ids.category, name: 'Category' })).rejects.toThrow('Admin access required')
  })

  test('rejects anonymous creation and editing another owner’s tool, including by admins', async () => {
    const { t, user, admin, ids } = await fixture()
    const fields = { name: 'Valid title', description: 'Valid description', condition: 'good' as const, categoryId: ids.category }
    await expect(value(t.mutation(api.tools.create, { ...fields, clientKey: 'unit-17351' }))).rejects.toThrow('Sign in required')
    await expect(value(user.mutation(api.tools.update, { toolId: ids.otherTool, ...fields }))).rejects.toThrow('only your own listings')
    await expect(value(admin.mutation(api.tools.update, { toolId: ids.otherTool, ...fields }))).rejects.toThrow('only your own listings')
  })

  test('detail queries preserve complete legacy text and protect private listings', async () => {
    const { t, user, other, ids } = await fixture()
    const name = 'LongUnbrokenTitle'.repeat(20)
    const description = 'LongUnbrokenDescription'.repeat(100)
    const category = 'LongUnbrokenCategory'.repeat(10)
    await t.run(ctx => ctx.db.patch('categories', ids.category, { name: category }))
    await t.run(ctx => ctx.db.patch('tools', ids.otherTool, { name, description, status: 'paused' }))
    await expect(t.query(api.tools.detail, { now: Date.now(), toolId: ids.otherTool })).rejects.toThrow('Sign in required')
    expect(await user.query(api.tools.detail, { now: Date.now(), toolId: ids.otherTool })).toBeNull()
    const detail = await other.query(api.tools.detail, { now: Date.now(), toolId: ids.otherTool })
    expect(detail?.name).toBe(name)
    expect(detail?.description).toBe(description)
    expect(detail?.category).toBe(category)
    expect(detail?.canEdit).toBe(true)
    await expect(t.query(api.tools.detail, { now: Date.now(), toolId: 'invalid' })).rejects.toThrow('Sign in required')
  })

  test('request participants retain full-text access after a listing is removed', async () => {
    const { t, other, ids } = await fixture()
    await t.run(ctx => ctx.db.patch('tools', ids.tools[0], { status: 'removed' }))
    await expect(t.query(api.tools.detail, { now: Date.now(), toolId: ids.tools[0] })).rejects.toThrow('Sign in required')
    expect((await other.query(api.tools.detail, { now: Date.now(), toolId: ids.tools[0] }))?.name).toBe('Drill 0')
  })

  test('shared frontend validation matches maxLength and never truncates input', () => {
    expect(textError('x'.repeat(80), 'Title', TEXT_LIMITS.title)).toBeNull()
    expect(textError('x'.repeat(81), 'Title', TEXT_LIMITS.title)).toContain('80')
    expect(textError('😀'.repeat(40), 'Title', TEXT_LIMITS.title)).toBeNull()
    expect(textError('😀'.repeat(41), 'Title', TEXT_LIMITS.title)).toContain('80')
    expect(textError('x'.repeat(40), 'Category', TEXT_LIMITS.category)).toBeNull()
    expect(textError('x'.repeat(41), 'Category', TEXT_LIMITS.category)).toContain('40')
    expect(textError('x'.repeat(500), 'Description', TEXT_LIMITS.description)).toBeNull()
    expect(textError('x'.repeat(501), 'Description', TEXT_LIMITS.description)).toContain('500')
  })
})

describe('Admin management and audit logging', () => {
  test('category CRUD retains references, lists removed categories, and supports restoration', async () => {
    const { t, admin, ids } = await fixture()
    const created = await admin.mutation(api.categories.create, { name: 'Painting' })
    await admin.mutation(api.categories.update, { categoryId: created, name: 'Painting supplies' })
    await admin.mutation(api.categories.remove, { categoryId: ids.category })
    await admin.mutation(api.categories.remove, { categoryId: ids.category })
    const categories = await admin.query(api.categories.list, { paginationOpts })
    expect(categories.page).toHaveLength(2)
    expect(categories.page.find(row => row.id === ids.category)?.isActive).toBe(false)
    expect((await t.run(ctx => ctx.db.get('tools', ids.otherTool)))?.categoryId).toBe(ids.category)
    expect((await t.query(api.catalog.publicTools, { now, paginationOpts })).page).toEqual([])
    await admin.mutation(api.categories.update, { categoryId: ids.category, name: 'Power Tools', isActive: true })
    const audit = await t.run(ctx => ctx.db.query('auditLogs').withIndex('by_createdAt').take(100))
    expect(audit.filter(row => row.action === 'category.removed')).toHaveLength(1)
    expect(audit.every(row => row.actorId === ids.admin)).toBe(true)
  })

  test('all users are listed and only admins can edit other users', async () => {
    const { t, admin, other, user, ids } = await fixture()
    const listed = await admin.query(api.adminUsers.list, { paginationOpts })
    expect(listed.page).toHaveLength(3)
    expect(listed.page.find(row => row.id === ids.admin)).toMatchObject({ role: 'admin', canEdit: false })
    await expect(user.query(api.adminUsers.list, { paginationOpts })).rejects.toThrow('Admin access required')
    await expect(user.mutation(api.adminUsers.update, { userId: ids.other, role: 'admin' })).rejects.toThrow('Admin access required')
    await admin.mutation(api.adminUsers.update, { userId: ids.other, role: 'admin', trusted: true })
    expect(await other.query(api.accounts.viewer, {})).toEqual({ role: 'admin' })
    const updated = await admin.query(api.adminUsers.list, { paginationOpts })
    expect(updated.page.find(row => row.id === ids.other)).toMatchObject({ role: 'admin', trusted: true })
    const audit = await t.run(ctx => ctx.db.query('auditLogs').withIndex('by_createdAt').take(10))
    expect(audit[0].changes).toMatchObject({ previousRole: 'user', role: 'admin', previousTrusted: false, trusted: true })
  })

  test('self-role and self-trust updates are denied in every public write path', async () => {
    const { admin, ids } = await fixture()
    await expect(admin.mutation(api.adminUsers.update, { userId: ids.admin, role: 'user' })).rejects.toThrow('own permissions')
    await expect(admin.mutation(api.adminUsers.update, { userId: ids.admin, trusted: true })).rejects.toThrow('own permissions')
    expect(await admin.query(api.accounts.viewer, {})).toEqual({ role: 'admin' })
  })

  test('trusted status can be revoked and the audit fields are cleared', async () => {
    const { t, admin, ids } = await fixture()
    await admin.mutation(api.adminUsers.update, { userId: ids.other, trusted: true })
    expect((await t.run(ctx => ctx.db.get('users', ids.other)))?.trustedBy).toBe(ids.admin)
    await admin.mutation(api.adminUsers.update, { userId: ids.other, trusted: false })
    const target = await t.run(ctx => ctx.db.get('users', ids.other))
    expect(target?.isTrustedLender).toBe(false)
    expect(target?.trustedBy).toBeUndefined()
    expect(target?.trustedAt).toBeUndefined()
  })

  test('role-only edits preserve trust attribution and unchanged retries do not add audit records', async () => {
    const { t, admin, other, ids } = await fixture()
    await admin.mutation(api.adminUsers.update, { userId: ids.other, role: 'admin' })
    await admin.mutation(api.adminUsers.update, { userId: ids.user, trusted: true })
    const before = await t.run(ctx => ctx.db.get('users', ids.user))
    await other.mutation(api.adminUsers.update, { userId: ids.user, role: 'admin', trusted: true })
    const after = await t.run(ctx => ctx.db.get('users', ids.user))
    expect(after?.trustedBy).toBe(before?.trustedBy)
    expect(after?.trustedAt).toBe(before?.trustedAt)
    const audit = await t.run(ctx => ctx.db.query('auditLogs').withIndex('by_createdAt').take(20))
    await other.mutation(api.adminUsers.update, { userId: ids.user, role: 'admin', trusted: true })
    expect(await t.run(ctx => ctx.db.query('auditLogs').withIndex('by_createdAt').take(20))).toHaveLength(audit.length)
  })

  test('owners can remove only their own tools and retries do not duplicate audit events', async () => {
    const { t, user, ids } = await fixture()
    await expect(user.mutation(api.tools.remove, { toolId: ids.otherTool })).rejects.toThrow('only your own listings')
    await user.mutation(api.tools.remove, { toolId: ids.tools[1] })
    await user.mutation(api.tools.remove, { toolId: ids.tools[1] })
    const rows = await t.run(ctx => ctx.db.query('auditLogs').withIndex('by_createdAt').take(100))
    expect(rows.filter(row => row.action === 'tool.removed')).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actorId: ids.user, targetId: ids.tools[1] })
  })

  test('expected validation returns a safe response without error logs or partial audit records', async () => {
    const { t, user, ids } = await fixture()
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    const payload = 'SensitiveUserInput'.repeat(20)
    try {
      await expect(user.mutation(api.tools.create, { clientKey: 'unit-25495', name: payload, categoryId: ids.category, description: 'Description', condition: 'good' })).resolves.toMatchObject({ ok: false, code: 'INVALID_TEXT', message: expect.stringContaining('80 characters or fewer') })
      expect(logger).not.toHaveBeenCalled()
      const output = JSON.stringify(logger.mock.calls)
      expect(output).not.toContain(payload)
      expect(await t.run(ctx => ctx.db.query('auditLogs').withIndex('by_createdAt').take(10))).toEqual([])
    } finally { logger.mockRestore() }
  })
})

describe('Seed data and categories', () => {
  test('the demo email is populated on creation and repaired without replacing the account', async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.seed.run, {})
    const owner = await t.run(ctx => ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', 'https://seed.lendloop.invalid|demo-lender')).unique())
    expect(owner?.email).toBe('test@gmail.com')
    await t.run(ctx => ctx.db.patch('users', owner!._id, { email: undefined, isTrustedLender: true }))
    expect(await t.mutation(internal.seed.run, {})).toEqual({ rolesCreated: 0, categoriesCreated: 0, usersCreated: 0, toolsCreated: 0 })
    const after = await t.run(ctx => ctx.db.get('users', owner!._id))
    expect(after).toMatchObject({ email: 'test@gmail.com', isTrustedLender: true, roleId: owner!.roleId })
  })
  test('seed categories contain only the new fields and reruns preserve their IDs', async () => {
    const t = convexTest(schema, modules)
    expect((await t.mutation(internal.seed.run, { includeDemoTools: false })).categoriesCreated).toBe(8)
    const before = await t.run(ctx => ctx.db.query('categories').withIndex('by_name').take(20))
    for (const category of before) {
      expect(Object.keys(category).sort()).toEqual(['_creationTime', '_id', 'isActive', 'name', 'sortOrder', 'updatedAt'])
    }
    expect((await t.mutation(internal.seed.run, { includeDemoTools: false })).categoriesCreated).toBe(0)
    const after = await t.run(ctx => ctx.db.query('categories').withIndex('by_name').take(20))
    expect(after.map(row => row._id)).toEqual(before.map(row => row._id))
  })

  test('category status is admin-only, audited, idempotent, and preserves tool references', async () => {
    const { t, admin, user, ids } = await fixture()
    await expect(user.mutation(api.categories.setStatus, { categoryId: ids.category, isActive: false })).rejects.toThrow('Admin access required')
    await admin.mutation(api.categories.setStatus, { categoryId: ids.category, isActive: false })
    await admin.mutation(api.categories.setStatus, { categoryId: ids.category, isActive: false })
    expect((await t.query(api.catalog.publicTools, { now, paginationOpts })).page).toEqual([])
    expect((await t.run(ctx => ctx.db.get('tools', ids.otherTool)))?.categoryId).toBe(ids.category)
    await admin.mutation(api.categories.setStatus, { categoryId: ids.category, isActive: true })
    const logs = await t.run(ctx => ctx.db.query('auditLogs').withIndex('by_createdAt').take(10))
    expect(logs.filter(log => log.action === 'category.status_updated')).toHaveLength(2)
  })

  test('legacy-field cleanup preserves category IDs, values, and timestamps', async () => {
    const legacySchema = defineSchema({ ...schema.tables, categories: defineTable({
      name: v.string(), slug: v.optional(v.string()), description: v.optional(v.string()),
      isActive: v.boolean(), sortOrder: v.number(), updatedAt: v.number(),
    }).index('by_name', ['name']) })
    const t = convexTest(legacySchema, modules)
    const id = await t.run(ctx => ctx.db.insert('categories', {
      name: 'Legacy garden', slug: 'garden', description: 'Old description', isActive: false, sortOrder: 7, updatedAt: now,
    }))
    const result = await t.mutation(internal.categoryMigration.removeLegacyFields, {})
    expect(result).toMatchObject({ scanned: 1, migrated: 1, isDone: true })
    const row = await t.run(ctx => ctx.db.get('categories', id))
    expect(row).toMatchObject({ _id: id, name: 'Legacy garden', isActive: false, sortOrder: 7, updatedAt: now })
    expect(row).not.toHaveProperty('slug')
    expect(row).not.toHaveProperty('description')
    expect((await t.mutation(internal.categoryMigration.removeLegacyFields, {})).migrated).toBe(0)
  })
})


describe('Listing identity and retries', () => {
  test('duplicates are scoped to owner/category, normalized, and rejected as normal responses', async () => {
    const { t, ids, user, other } = await fixture()
    const fields = { name: ' New   Drill ', description: 'A drill', condition: 'good' as const, categoryId: ids.category, clientKey: 'listing-key' }
    const first = await user.mutation(api.tools.create, fields)
    expect(first.ok).toBe(true)
    expect(await user.mutation(api.tools.create, fields)).toEqual(first)
    await expect(user.mutation(api.tools.create, { ...fields, clientKey: 'second-key', name: 'new drill' })).resolves.toMatchObject({ ok: false, code: 'DUPLICATE_TOOL' })
    await expect(user.mutation(api.tools.create, { ...fields, description: 'Changed' })).resolves.toMatchObject({ ok: false, code: 'SUBMISSION_CONFLICT' })
    expect((await other.mutation(api.tools.create, fields)).ok).toBe(true)
    const categoryId = await t.run(ctx => ctx.db.insert('categories', { name: 'Other', isActive: true, sortOrder: 1, updatedAt: now }))
    expect((await user.mutation(api.tools.create, { ...fields, categoryId, clientKey: 'different-category' })).ok).toBe(true)
    await expect(user.mutation(api.tools.update, { toolId: ids.tools[1], name: 'NEW DRILL', categoryId: ids.category, description: 'Updated', condition: 'good' })).resolves.toMatchObject({ ok: false, code: 'DUPLICATE_TOOL' })
    expect((await t.run(ctx => ctx.db.get('tools', ids.tools[1])))?.name).toBe('Drill 1')
  })
})
