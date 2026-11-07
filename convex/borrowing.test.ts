/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import schema from './schema'
import type { BusinessResult } from '../shared/result'
import { api, internal } from './_generated/api'
import { signature } from './integrationAuth'
import { enqueue } from './alarms'

// Unwrap successful results in existing behavior tests; validation tests assert raw results.
async function value<T>(promise: Promise<BusinessResult<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new Error(result.message)
  return result.value
}

const modules = import.meta.glob('./**/*.ts')
const DAY = 86_400_000
const today = Date.UTC(2030, 0, 10)
const paginationOpts = { numItems: 12, cursor: null }

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(today + 12 * 3_600_000) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    const roleId = await ctx.db.insert('roles', { name: 'user', description: '', updatedAt: today })
    const adminRole = await ctx.db.insert('roles', { name: 'admin', description: '', updatedAt: today })
    const users = []
    for (const name of ['lender', 'borrower', 'other', 'admin']) users.push(await ctx.db.insert('users', {
      name, clerkId: name, tokenIdentifier: `test|${name}`, roleId: name === 'admin' ? adminRole : roleId,
      isTrustedLender: false, isActive: true, updatedAt: today,
    }))
    const categoryId = await ctx.db.insert('categories', { name: 'Tools', isActive: true, sortOrder: 0, updatedAt: today })
    const toolId = await ctx.db.insert('tools', { name: 'Drill', categoryId, ownerId: users[0], condition: 'good', description: 'A drill.', status: 'active', updatedAt: today })
    return { lender: users[0], borrower: users[1], other: users[2], admin: users[3], toolId }
  })
  const actor = (name: string) => t.withIdentity({ subject: name, tokenIdentifier: `test|${name}` })
  const dates = { toolId: ids.toolId, startAt: today + DAY, endAt: today + 3 * DAY, clientKey: 'first-request' }
  return { t, ids, dates, lender: actor('lender'), borrower: actor('borrower'), other: actor('other'), admin: actor('admin') }
}

test('request creation is authenticated, date-validated, and cannot target own or inactive tools', async () => {
  const { t, ids, dates, lender, borrower } = await setup()
  await expect(value(t.mutation(api.borrowing.create, dates))).rejects.toThrow('Sign in required')
  await expect(value(lender.mutation(api.borrowing.create, dates))).rejects.toThrow('own tool')
  await expect(value(borrower.mutation(api.borrowing.create, { ...dates, endAt: dates.startAt }))).rejects.toThrow('Choose dates')
  await expect(value(borrower.mutation(api.borrowing.create, { ...dates, startAt: today - DAY }))).rejects.toThrow('Choose dates')
  await t.run(ctx => ctx.db.patch('users', ids.lender, { isActive: false }))
  await expect(value(borrower.mutation(api.borrowing.create, dates))).rejects.toThrow('unavailable')
})

test('request retries create one request, one lender alarm, and one logical outbox event', async () => {
  const { t, ids, dates, borrower, lender, other } = await setup()
  const id = await value(borrower.mutation(api.borrowing.create, dates))
  expect(await value(borrower.mutation(api.borrowing.create, dates))).toBe(id)
  await expect(value(borrower.mutation(api.borrowing.create, { ...dates, endAt: dates.endAt + DAY }))).rejects.toThrow('identifier already used')
  expect(await t.run(ctx => ctx.db.query('borrowRequests').take(10))).toHaveLength(1)
  expect(await t.run(ctx => ctx.db.query('automationEvents').take(10))).toHaveLength(1)
  const alarms = await lender.query(api.alarms.list, {})
  expect(alarms).toHaveLength(1)
  expect(alarms[0]).toMatchObject({ href: '/incoming-requests', unread: true })
  expect(await borrower.query(api.alarms.list, {})).toEqual([])
  expect(await other.query(api.alarms.list, {})).toEqual([])
  await expect(other.mutation(api.alarms.markRead, { alarmId: alarms[0].id })).rejects.toThrow('Alarm not found')
  await lender.mutation(api.alarms.markRead, { alarmId: alarms[0].id })
  expect(await lender.query(api.alarms.list, {})).toEqual([expect.objectContaining({ unread: false })])
  expect((await t.run(ctx => ctx.db.get('tools', ids.toolId)))?.status).toBe('active')
})

test('only the lender can decide; repeated approvals cannot duplicate loans or alarms', async () => {
  const { t, dates, borrower, lender, other, admin } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, dates))
  for (const actor of [borrower, other, admin]) await expect(value(actor.mutation(api.borrowing.decide, { requestId, decision: 'approved' }))).rejects.toThrow('Only the lender')
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'approved' }))
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'approved' }))
  expect(await t.run(ctx => ctx.db.query('loans').take(10))).toHaveLength(1)
  expect(await t.run(ctx => ctx.db.query('alarms').take(10))).toHaveLength(2)
  await expect(value(lender.mutation(api.borrowing.decide, { requestId, decision: 'declined' }))).rejects.toThrow('already been decided')
  await expect(value(other.mutation(api.borrowing.create, { ...dates, clientKey: 'other' }))).rejects.toThrow('already booked')
})

test('overlapping pending requests cannot both be approved; incoming requests sort by date', async () => {
  const { t, dates, borrower, other, lender } = await setup()
  const late = await value(borrower.mutation(api.borrowing.create, { ...dates, startAt: today + 5 * DAY, endAt: today + 8 * DAY }))
  const early = await value(other.mutation(api.borrowing.create, { ...dates, clientKey: 'early', startAt: today + 4 * DAY, endAt: today + 7 * DAY }))
  expect((await lender.query(api.workspace.requests, { incoming: true, paginationOpts })).page.map(row => row.id)).toEqual([early, late])
  await value(lender.mutation(api.borrowing.decide, { requestId: late, decision: 'approved' }))
  await expect(value(lender.mutation(api.borrowing.decide, { requestId: early, decision: 'approved' }))).rejects.toThrow('already booked')
  await value(lender.mutation(api.borrowing.decide, { requestId: early, decision: 'declined' }))
  expect(await t.run(ctx => ctx.db.query('loans').take(10))).toHaveLength(1)
})

test('approval activates a loan and return enforces owner permissions', async () => {
  const { t, dates, borrower, lender, other, admin } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, { ...dates, startAt: today }))
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'approved' }))
  const loan = await t.run(ctx => ctx.db.query('loans').first())
  const loanId = loan!._id
  for (const actor of [borrower, other, admin]) await expect(value(actor.mutation(api.borrowing.returnLoan, { loanId }))).rejects.toThrow('Only the tool owner')
  await value(lender.mutation(api.borrowing.returnLoan, { loanId }))
  expect((await t.run(ctx => ctx.db.get('loans', loanId)))?.returnedBy).toBe(loan!.lenderId)
})

test('daily overdue reminders and their write-backs are idempotent', async () => {
  const { t, dates, borrower, lender } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, { ...dates, startAt: today, endAt: today + DAY }))
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'approved' }))
  const loan = await t.run(ctx => ctx.db.query('loans').first())
  await t.run(ctx => ctx.db.patch('loans', loan!._id, { status: 'active', dueAt: today }))
  const first = await t.mutation(internal.automation.overdue, { cursor: null })
  const second = await t.mutation(internal.automation.overdue, { cursor: null })
  expect(first.events).toHaveLength(1)
  expect(second.events[0].eventId).toBe(first.events[0].eventId)
  const event = first.events[0]
  await t.mutation(internal.automation.complete, { eventId: event.eventId, idempotencyKey: event.idempotencyKey })
  await t.mutation(internal.automation.complete, { eventId: event.eventId, idempotencyKey: event.idempotencyKey })
  expect((await t.run(ctx => ctx.db.get('loans', loan!._id)))?.reminderCount).toBe(1)
  expect((await t.mutation(internal.automation.overdue, { cursor: null })).events).toEqual([])
  expect(await t.query(internal.overdue.inspect, { now: Date.now(), cursor: null, phase: 'active' })).toMatchObject({ overdueLoans: 1, missingAlarms: 0 })
  vi.setSystemTime(Date.now() + DAY)
  const nextDay = await t.mutation(internal.automation.overdue, { cursor: null })
  expect(nextDay.events).toHaveLength(1)
  await t.mutation(internal.automation.complete, { eventId: nextDay.events[0].eventId, idempotencyKey: nextDay.events[0].idempotencyKey })
  expect((await t.run(ctx => ctx.db.get('loans', loan!._id)))?.reminderCount).toBe(2)
})

test('integration endpoints reject tampering and expired signatures, and accept safe retries', async () => {
  const { t, dates, borrower } = await setup()
  vi.stubEnv('AUTOMATION_SHARED_SECRET', 'test-shared-secret')
  await value(borrower.mutation(api.borrowing.create, dates))
  const event = await t.run(ctx => ctx.db.query('automationEvents').first())
  const body = JSON.stringify({ eventId: event!._id, idempotencyKey: event!.idempotencyKey })
  const path = '/automation/complete'
  const timestamp = String(Math.floor(Date.now() / 1000))
  const headers = { 'x-lendloop-timestamp': timestamp, 'x-lendloop-signature': await signature('test-shared-secret', `${timestamp}.POST.${path}.${body}`) }
  expect((await t.fetch(path, { method: 'POST', body })).status).toBe(401)
  expect((await t.fetch(path, { method: 'POST', body: body + ' ', headers })).status).toBe(401)
  expect((await t.fetch(path, { method: 'POST', body, headers })).status).toBe(200)
  expect((await t.fetch(path, { method: 'POST', body, headers })).status).toBe(200)
  vi.setSystemTime(Date.now() + 301_000)
  expect((await t.fetch(path, { method: 'POST', body, headers })).status).toBe(401)
})

test('an overdue reminder is skipped if the tool is returned before a retry', async () => {
  const { t, dates, borrower, lender } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, { ...dates, startAt: today, endAt: today + DAY }))
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'approved' }))
  const loan = await t.run(ctx => ctx.db.query('loans').first())
  await t.run(ctx => ctx.db.patch('loans', loan!._id, { status: 'active', dueAt: today }))
  const overdue = await t.mutation(internal.automation.overdue, { cursor: null })
  await value(lender.mutation(api.borrowing.returnLoan, { loanId: loan!._id }))
  await t.action(internal.automation.deliver, { eventId: overdue.events[0].eventId })
  const event = await t.run(ctx => ctx.db.get('automationEvents', overdue.events[0].eventId))
  expect(event?.status).toBe('skipped')
  expect((await t.run(ctx => ctx.db.get('loans', loan!._id)))?.reminderCount).toBe(0)
})

test('delivery failures are recorded with retries and never lose the original request', async () => {
  const { t, dates, borrower } = await setup()
  await value(borrower.mutation(api.borrowing.create, dates))
  const event = await t.run(ctx => ctx.db.query('automationEvents').first())
  await t.action(internal.automation.deliver, { eventId: event!._id })
  const failed = await t.run(ctx => ctx.db.get('automationEvents', event!._id))
  expect(failed).toMatchObject({ status: 'failed', attemptCount: 1, lastError: 'n8n integration is not configured.' })
  expect(failed!.nextAttemptAt).toBeGreaterThan(Date.now())
  expect(await t.run(ctx => ctx.db.query('borrowRequests').take(10))).toHaveLength(1)
})

test('user activation is admin-only, self-protected, and audited', async () => {
  const { t, ids, admin, borrower } = await setup()
  await expect(borrower.mutation(api.adminUsers.update, { userId: ids.lender, isActive: false })).rejects.toThrow('Admin access required')
  await expect(admin.mutation(api.adminUsers.update, { userId: ids.admin, isActive: false })).rejects.toThrow('own permissions')
  await admin.mutation(api.adminUsers.update, { userId: ids.borrower, isActive: false })
  await expect(borrower.query(api.alarms.list, {})).rejects.toThrow('Active account required')
  const audit = await t.run(ctx => ctx.db.query('auditLogs').first())
  expect(audit!.changes).toMatchObject({ previousActive: true, isActive: false })
  await admin.mutation(api.adminUsers.update, { userId: ids.borrower, isActive: true })
  expect(await borrower.query(api.alarms.list, {})).toEqual([])
})

test('new submissions reject identical and overlapping pending dates but allow adjacent ranges', async () => {
  const { t, dates, borrower, lender } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, dates))
  expect(await value(borrower.mutation(api.borrowing.create, dates))).toBe(requestId)
  await expect(value(borrower.mutation(api.borrowing.create, { ...dates, clientKey: 'duplicate' }))).rejects.toThrow('already requested this tool for these dates')
  await expect(value(borrower.mutation(api.borrowing.create, { ...dates, clientKey: 'overlap', startAt: dates.startAt + DAY, endAt: dates.endAt + DAY }))).rejects.toThrow('pending request for this tool with overlapping dates')
  await value(borrower.mutation(api.borrowing.create, { ...dates, clientKey: 'adjacent', startAt: dates.endAt, endAt: dates.endAt + DAY }))
  expect(await t.run(ctx => ctx.db.query('borrowRequests').take(10))).toHaveLength(2)
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'declined' }))
  await value(borrower.mutation(api.borrowing.create, { ...dates, clientKey: 'after-decline' }))
})

test('an active tool cannot be requested again, even for dates after its planned return', async () => {
  const { t, dates, borrower, lender, other } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, { ...dates, startAt: today }))
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'approved' }))
  const loan = await t.run(ctx => ctx.db.query('loans').first())
  await expect(value(other.mutation(api.borrowing.create, { ...dates, startAt: today + 20 * DAY, endAt: today + 21 * DAY }))).rejects.toThrow('currently borrowed and has not been returned')
  await value(lender.mutation(api.borrowing.returnLoan, { loanId: loan!._id }))
  await value(other.mutation(api.borrowing.create, { ...dates, startAt: today + 20 * DAY, endAt: today + 21 * DAY }))
})

test('unread counts include alarms outside the recent menu and read/retry operations are idempotent', async () => {
  const { t, ids, dates, borrower, lender } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, dates))
  await t.run(async ctx => {
    for (let i = 0; i < 40; i++) await enqueue(ctx, { idempotencyKey: `counter-${i}`, recipientId: ids.lender, requestId, title: 'New request', message: 'Drill', href: '/incoming-requests' }, false)
  })
  expect(await lender.query(api.alarms.list, {})).toHaveLength(5)
  expect(await lender.query(api.alarms.unreadCount, {})).toBe(41)
  const alarm = (await lender.query(api.alarms.list, {}))[0]
  await lender.mutation(api.alarms.markRead, { alarmId: alarm.id })
  await lender.mutation(api.alarms.markRead, { alarmId: alarm.id })
  expect(await lender.query(api.alarms.unreadCount, {})).toBe(40)
  await lender.mutation(api.alarms.markAllRead, {})
  await lender.mutation(api.alarms.markAllRead, {})
  expect(await lender.query(api.alarms.unreadCount, {})).toBe(0)
  expect(await borrower.query(api.alarms.unreadCount, {})).toBe(0)
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'approved' }))
  expect(await lender.query(api.alarms.unreadCount, {})).toBe(0)
  expect(await borrower.query(api.alarms.unreadCount, {})).toBe(1)
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'approved' }))
  const event = await t.run(ctx => ctx.db.query('automationEvents').first())
  await t.mutation(internal.automation.complete, { eventId: event!._id, idempotencyKey: event!.idempotencyKey })
  await t.mutation(internal.automation.complete, { eventId: event!._id, idempotencyKey: event!.idempotencyKey })
  expect(await borrower.query(api.alarms.unreadCount, {})).toBe(1)
})

test('overdue pagination includes approved loans without a recorded handover', async () => {
  const { t, dates, borrower, lender } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, dates))
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'approved' }))
  const loan = await t.run(ctx => ctx.db.query('loans').first())
  await t.run(ctx => ctx.db.patch('loans', loan!._id, { dueAt: today, status: 'scheduled' }))
  const activePage = await t.mutation(internal.automation.overdue, { cursor: null })
  expect(activePage.events).toEqual([])
  expect(activePage.isDone).toBe(false)
  const scheduledPage = await t.mutation(internal.automation.overdue, { cursor: activePage.cursor })
  expect(scheduledPage.isDone).toBe(true)
  expect(scheduledPage.events).toHaveLength(1)
  const event = scheduledPage.events[0]
  await t.mutation(internal.automation.complete, { eventId: event.eventId, idempotencyKey: event.idempotencyKey })
  await t.mutation(internal.automation.complete, { eventId: event.eventId, idempotencyKey: event.idempotencyKey })
  expect((await t.run(ctx => ctx.db.get('loans', loan!._id)))?.reminderCount).toBe(1)
})

test('tool projections reveal only whether the current viewer is the owner', async () => {
  const { t, ids, lender, borrower } = await setup()
  const args = { now: Date.now(), paginationOpts }
  expect((await lender.query(api.catalog.memberTools, args)).page[0].isOwner).toBe(true)
  expect((await borrower.query(api.catalog.memberTools, args)).page[0].isOwner).toBe(false)
  expect(Object.keys((await t.query(api.catalog.publicTools, args)).page[0]).sort()).toEqual(['category', 'id', 'name'])
  expect((await lender.query(api.tools.detail, { now: Date.now(), toolId: ids.toolId }))?.isOwner).toBe(true)
})

test('batched read-all preserves alarms that arrive after the menu was opened', async () => {
  const { t, ids, dates, borrower, lender } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, dates))
  await t.run(async ctx => {
    for (let i = 0; i < 129; i++) await enqueue(ctx, { idempotencyKey: `batch-${i}`, recipientId: ids.lender, requestId, title: 'Request', message: 'Drill', href: '/incoming-requests' }, false)
  })
  expect(await lender.query(api.alarms.unreadCount, {})).toBe(130)
  const cutoff = await t.run(async ctx => (await ctx.db.query('alarms').withIndex('by_recipientId_and_createdAt', q => q.eq('recipientId', ids.lender)).order('desc').first())!.createdAt)
  await lender.mutation(api.alarms.markAllRead, {})
  expect(await lender.query(api.alarms.unreadCount, {})).toBe(30)
  vi.setSystemTime(Date.now() + 1)
  await t.run(async ctx => {
    await enqueue(ctx, { idempotencyKey: 'after-menu', recipientId: ids.lender, requestId, title: 'New arrival', message: 'Drill', href: '/incoming-requests' }, false)
    const alarm = await ctx.db.query('alarms').withIndex('by_idempotencyKey', q => q.eq('idempotencyKey', `after-menu:${ids.lender}`)).unique()
    await ctx.db.patch('alarms', alarm!._id, { createdAt: cutoff + 1 })
  })
  await t.mutation(internal.alarms.readOlder, { userId: ids.lender, cutoff })
  expect(await lender.query(api.alarms.unreadCount, {})).toBe(1)
  expect((await lender.query(api.alarms.list, {}))[0]).toMatchObject({ title: 'New arrival', unread: true })
})

test('duplicate validation resolves normally without error logging or extra writes', async () => {
  const { t, dates, borrower } = await setup()
  await borrower.mutation(api.borrowing.create, dates)
  const logger = vi.spyOn(console, 'error')
  try {
    await expect(borrower.mutation(api.borrowing.create, { ...dates, clientKey: 'duplicate' })).resolves.toMatchObject({ ok: false, code: 'DUPLICATE_REQUEST' })
    await expect(borrower.mutation(api.borrowing.create, { ...dates, clientKey: 'overlap', startAt: dates.startAt + DAY })).resolves.toMatchObject({ ok: false, code: 'PENDING_OVERLAP' })
    expect(logger).not.toHaveBeenCalled()
    expect(await t.run(ctx => ctx.db.query('borrowRequests').take(10))).toHaveLength(1)
    expect(await t.run(ctx => ctx.db.query('automationEvents').take(10))).toHaveLength(1)
  } finally { logger.mockRestore() }
})

test('viewing a request consumes only that participant’s alarms and keeps counters correct', async () => {
  const { dates, borrower, lender, other } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, dates))
  await expect(other.mutation(api.alarms.consumeRequests, { requestIds: [requestId], incoming: true })).rejects.toThrow('not yours')
  await lender.mutation(api.alarms.consumeRequests, { requestIds: [requestId], incoming: true })
  expect(await lender.query(api.alarms.list, {})).toEqual([expect.objectContaining({ unread: false })])
  expect(await lender.query(api.alarms.unreadCount, {})).toBe(0)
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'approved' }))
  expect(await borrower.query(api.alarms.unreadCount, {})).toBe(1)
  await lender.mutation(api.alarms.consumeRequests, { requestIds: [requestId], incoming: true })
  expect(await borrower.query(api.alarms.unreadCount, {})).toBe(1)
  await borrower.mutation(api.alarms.consumeRequests, { requestIds: [requestId], incoming: false })
  await borrower.mutation(api.alarms.consumeRequests, { requestIds: [requestId], incoming: false })
  expect(await borrower.query(api.alarms.list, {})).toEqual([expect.objectContaining({ unread: false })])
  expect(await borrower.query(api.alarms.unreadCount, {})).toBe(0)
})

test('returns are idempotent and leave active views while preserving recorded history', async () => {
  const { t, dates, borrower, lender } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, { ...dates, startAt: today }))
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'approved' }))
  const loan = (await t.run(ctx => ctx.db.query('loans').first()))!
  expect(loan.status).toBe('active')
  await value(lender.mutation(api.borrowing.returnLoan, { loanId: loan._id }))
  const returned = await t.run(ctx => ctx.db.get('loans', loan._id))
  vi.setSystemTime(Date.now() + DAY)
  await value(lender.mutation(api.borrowing.returnLoan, { loanId: loan._id }))
  expect(await t.run(ctx => ctx.db.get('loans', loan._id))).toEqual(returned)
  expect((await t.run(ctx => ctx.db.query('auditLogs').take(20))).filter(row => row.action === 'loan.returned')).toHaveLength(1)
  for (const [actor, incoming] of [[borrower, false], [lender, true]] as const) {
    const history = await actor.query(api.workspace.requests, { incoming, paginationOpts })
    expect(history.page).toEqual([])
  }
  expect((await t.mutation(internal.automation.overdue, { cursor: null })).events).toEqual([])
})

test('one logical event can fan out to recipients without duplicating the event on retries', async () => {
  const { t, ids, dates, borrower } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, dates))
  const notice = { idempotencyKey: 'fanout', recipientId: ids.lender, requestId, title: 'Update', message: 'Drill', href: '/incoming-requests' }
  const eventId = await t.run(ctx => enqueue(ctx, notice, false, [{ ...notice, recipientId: ids.borrower, href: '/my-requests' }]))
  expect(await t.run(ctx => enqueue(ctx, notice, false))).toBe(eventId)
  const payload = await t.mutation(internal.automation.claim, { eventId })
  expect(payload?.notifications).toHaveLength(2)
  expect((await t.run(ctx => ctx.db.query('automationEvents').take(10))).filter(row => row.idempotencyKey === 'fanout')).toHaveLength(1)
})

test('legacy event consolidation preserves the intended delivery and activates scheduled loans', async () => {
  const { t, ids, dates, borrower, lender } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, dates))
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'approved' }))
  await t.run(async ctx => {
    const event = (await ctx.db.query('automationEvents').first())!
    await ctx.db.patch('automationEvents', event._id, { idempotencyKey: `${event.idempotencyKey}:${ids.lender}`, status: 'sent', sentAt: today })
    const { _id, _creationTime, ...copy } = event
    void _id; void _creationTime
    await ctx.db.insert('automationEvents', { ...copy, recipientId: ids.borrower, idempotencyKey: `${event.idempotencyKey}:${ids.borrower}` })
    const loan = (await ctx.db.query('loans').first())!
    await ctx.db.patch('loans', loan._id, { status: 'scheduled' })
  })
  expect(await t.query(internal.maintenance.inspectRequests, { cursor: null })).toMatchObject({ duplicateEventRows: 1, legacyScheduled: 1 })
  expect(await t.mutation(internal.maintenance.repairRequests, { cursor: null })).toMatchObject({ removedEvents: 1, activatedLoans: 1 })
  expect(await t.query(internal.maintenance.inspectRequests, { cursor: null })).toMatchObject({ duplicateEventRows: 0, legacyScheduled: 0 })
  expect((await t.run(ctx => ctx.db.query('automationEvents').first()))?.status).toBe('sent')
  expect(await t.mutation(internal.maintenance.repairRequests, { cursor: null })).toMatchObject({ removedEvents: 0, activatedLoans: 0 })
})

test('one created event performs one signed webhook call and retrying a completed delivery is a no-op', async () => {
  const { t, dates, borrower } = await setup()
  vi.stubEnv('N8N_WEBHOOK_URL', 'https://example.invalid/webhook/lendloop-requests')
  vi.stubEnv('AUTOMATION_SHARED_SECRET', 'test-shared-secret')
  const fetchMock = vi.fn().mockImplementation(async () => Response.json({ delivered: true }))
  vi.stubGlobal('fetch', fetchMock)
  await borrower.mutation(api.borrowing.create, dates)
  const event = (await t.run(ctx => ctx.db.query('automationEvents').first()))!
  await t.action(internal.automation.deliver, { eventId: event._id })
  await t.action(internal.automation.deliver, { eventId: event._id })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const options = fetchMock.mock.calls[0][1] as RequestInit
  const body = JSON.parse(String(options.body)) as { payload: string }
  const headers = options.headers as Record<string, string>
  expect(headers['x-lendloop-signature']).toBe(await signature('test-shared-secret', `${headers['x-lendloop-timestamp']}.${body.payload}`))
  expect(JSON.parse(body.payload).notifications).toHaveLength(1)
  expect((await t.run(ctx => ctx.db.get('automationEvents', event._id)))?.status).toBe('sent')
})

test('tool actions follow real pending, borrowed, overdue, and returned state', async () => {
  const { t, ids, dates, borrower, lender, other } = await setup()
  const read = () => other.query(api.tools.detail, { toolId: ids.toolId, now: Date.now() })
  expect(await read()).toMatchObject({ availability: 'available', canBorrow: true })
  const requestId = await value(borrower.mutation(api.borrowing.create, dates))
  for (const actor of [borrower, lender, other]) expect(await actor.query(api.tools.detail, { toolId: ids.toolId, now: Date.now() })).toMatchObject({ availability: 'pending', canBorrow: false })
  expect((await other.query(api.catalog.memberTools, { now: Date.now(), paginationOpts })).page[0]).toMatchObject({ availability: 'pending', canBorrow: false })
  expect((await t.query(api.catalog.publicTools, { now: Date.now(), paginationOpts })).page).toEqual([])
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'approved' }))
  expect(await read()).toMatchObject({ availability: 'borrowed', canBorrow: false })
  vi.setSystemTime(dates.startAt + 1000)
  expect(await read()).toMatchObject({ availability: 'borrowed', canBorrow: false })
  vi.setSystemTime(dates.endAt + 1000)
  expect(await read()).toMatchObject({ availability: 'overdue', canBorrow: false })
  const loan = (await t.run(ctx => ctx.db.query('loans').first()))!
  await value(lender.mutation(api.borrowing.returnLoan, { loanId: loan._id }))
  expect(await read()).toMatchObject({ availability: 'available', canBorrow: true })
})

test('declined and expired pending requests release the tool status', async () => {
  const { ids, dates, borrower, lender, other } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, dates))
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'declined' }))
  expect(await other.query(api.tools.detail, { toolId: ids.toolId, now: Date.now() })).toMatchObject({ availability: 'available', canBorrow: true })
  await value(borrower.mutation(api.borrowing.create, { ...dates, clientKey: 'new-pending' }))
  vi.setSystemTime(dates.endAt + 1000)
  expect(await other.query(api.tools.detail, { toolId: ids.toolId, now: Date.now() })).toMatchObject({ availability: 'available', canBorrow: true })
})

test('declines and returns leave both active request lists without deleting history; returning permits borrowing again', async () => {
  const { t, ids, dates, borrower, lender, other } = await setup()
  const declined = await value(borrower.mutation(api.borrowing.create, dates))
  await value(lender.mutation(api.borrowing.decide, { requestId: declined, decision: 'declined' }))
  for (const [actor, incoming] of [[borrower, false], [lender, true]] as const) expect((await actor.query(api.workspace.requests, { incoming, paginationOpts })).page).toEqual([])
  expect((await t.run(ctx => ctx.db.get('borrowRequests', declined)))?.status).toBe('declined')
  const approved = await value(borrower.mutation(api.borrowing.create, { ...dates, clientKey: 'second', startAt: today }))
  await value(lender.mutation(api.borrowing.decide, { requestId: approved, decision: 'approved' }))
  expect((await borrower.query(api.workspace.requests, { incoming: false, paginationOpts })).page.map(row => row.id)).toEqual([approved])
  const loan = (await t.run(ctx => ctx.db.query('loans').first()))!
  await value(lender.mutation(api.borrowing.returnLoan, { loanId: loan._id }))
  for (const [actor, incoming] of [[borrower, false], [lender, true]] as const) expect((await actor.query(api.workspace.requests, { incoming, paginationOpts })).page).toEqual([])
  expect(await t.run(ctx => ctx.db.get('loans', loan._id))).toMatchObject({ status: 'returned', returnedAt: expect.any(Number) })
  expect(await other.query(api.tools.detail, { toolId: ids.toolId, now: Date.now() })).toMatchObject({ availability: 'available', canBorrow: true })
  expect((await other.mutation(api.borrowing.create, { ...dates, clientKey: 'after-return' })).ok).toBe(true)
  expect((await borrower.query(api.alarms.list, {})).map(row => row.title)).toContain('Loan returned')
})

test('deadline alarm is persisted without n8n, stays visible after reading, and deduplicates with daily delivery', async () => {
  const { t, dates, borrower, lender } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, { ...dates, startAt: today }))
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'approved' }))
  const loan = (await t.run(ctx => ctx.db.query('loans').first()))!
  const scheduled = await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(20))
  expect(scheduled.some(job => job.name.includes('overdue') && job.scheduledTime === loan.dueAt + 1)).toBe(true)
  await borrower.mutation(api.alarms.markAllRead, {})
  expect(await t.mutation(internal.overdue.atDue, { loanId: loan._id })).toBeNull()
  vi.setSystemTime(loan.dueAt + 1)
  const eventId = await t.mutation(internal.overdue.atDue, { loanId: loan._id })
  expect(eventId).not.toBeNull()
  expect((await borrower.query(api.alarms.list, {}))[0]).toMatchObject({ title: 'Overdue tool', unread: true, href: '/my-requests' })
  expect(await borrower.query(api.alarms.unreadCount, {})).toBe(1)
  expect((await t.run(ctx => ctx.db.get('loans', loan._id)))?.overdueAlarmCreatedAt).toBe(Date.now())
  await t.action(internal.automation.deliver, { eventId: eventId! })
  expect((await t.run(ctx => ctx.db.get('automationEvents', eventId!)))?.status).toBe('failed')
  const alarm = (await borrower.query(api.alarms.list, {}))[0]
  await borrower.mutation(api.alarms.markRead, { alarmId: alarm.id })
  await borrower.mutation(api.alarms.markRead, { alarmId: alarm.id })
  expect((await borrower.query(api.alarms.list, {}))[0]).toMatchObject({ id: alarm.id, unread: false })
  expect(await borrower.query(api.alarms.unreadCount, {})).toBe(0)
  expect(await t.mutation(internal.overdue.atDue, { loanId: loan._id })).toBeNull()
  const daily = await t.mutation(internal.automation.overdue, { cursor: null })
  expect(daily.events[0].eventId).toBe(eventId)
  for (let i = 0; i < 2; i++) await t.mutation(internal.automation.complete, { eventId: eventId!, idempotencyKey: daily.events[0].idempotencyKey })
  expect((await t.run(ctx => ctx.db.get('loans', loan._id)))?.reminderCount).toBe(1)
  expect((await t.run(ctx => ctx.db.query('alarms').take(20))).filter(row => row.loanId === loan._id)).toHaveLength(1)
  expect((await t.mutation(internal.automation.overdue, { cursor: null })).events).toEqual([])
})

test('recovery persists missing overdue alarms once; returned loans never get a deadline alarm', async () => {
  const { t, dates, borrower, lender } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, dates))
  await value(lender.mutation(api.borrowing.decide, { requestId, decision: 'approved' }))
  const loan = (await t.run(ctx => ctx.db.query('loans').first()))!
  await t.run(ctx => ctx.db.patch('loans', loan._id, { dueAt: Date.now() - 1 }))
  expect(await t.mutation(internal.overdue.recover, {})).toMatchObject({ ensured: 1 })
  expect(await t.mutation(internal.overdue.recover, {})).toMatchObject({ ensured: 0 })
  expect((await borrower.query(api.alarms.list, {})).filter(row => row.title === 'Overdue tool')).toHaveLength(1)
  await value(lender.mutation(api.borrowing.returnLoan, { loanId: loan._id }))
  vi.setSystemTime(Date.now() + 2 * DAY)
  expect(await t.mutation(internal.overdue.atDue, { loanId: loan._id })).toBeNull()
  expect((await t.mutation(internal.automation.overdue, { cursor: null })).events).toEqual([])
})

test('read-history repair restores valid alarms but keeps suppressed legacy duplicates hidden', async () => {
  const { t, ids, dates, borrower, lender } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, dates))
  const original = (await lender.query(api.alarms.list, {}))[0]
  await lender.mutation(api.alarms.markRead, { alarmId: original.id })
  await t.run(async ctx => {
    await ctx.db.patch('alarms', original.id, { dismissedAt: Date.now() })
    await ctx.db.insert('alarms', { recipientId: ids.lender, requestId, title: 'Old duplicate', message: 'Ignored', href: '/incoming-requests', idempotencyKey: 'legacy:duplicate', createdAt: Date.now(), readAt: Date.now(), dismissedAt: Date.now() })
  })
  expect(await t.mutation(internal.alarms.restoreReadHistory, { cursor: null })).toMatchObject({ restored: 1 })
  expect(await lender.query(api.alarms.list, {})).toEqual([expect.objectContaining({ id: original.id, unread: false })])
  expect(await lender.query(api.alarms.unreadCount, {})).toBe(0)
  expect(await t.mutation(internal.alarms.restoreReadHistory, { cursor: null })).toMatchObject({ restored: 0 })
})

test('active request pagination continues past pages containing only closed history', async () => {
  const { t, ids, dates, borrower, lender } = await setup()
  await t.run(async ctx => {
    for (let i = 0; i < 13; i++) await ctx.db.insert('borrowRequests', { toolId: ids.toolId, lenderId: ids.lender, borrowerId: ids.borrower,
      startAt: today - DAY, endAt: today, status: 'declined', statusVersion: 2, updatedAt: today })
  })
  const activeId = await value(borrower.mutation(api.borrowing.create, dates))
  for (const [actor, incoming] of [[borrower, false], [lender, true]] as const) {
    const first = await actor.query(api.workspace.requests, { incoming, paginationOpts })
    expect(first.page).toEqual([])
    expect(first.isDone).toBe(false)
    const second = await actor.query(api.workspace.requests, { incoming, paginationOpts: { ...paginationOpts, cursor: first.continueCursor } })
    expect(second.page.map(row => row.id)).toEqual([activeId])
  }
})

test('alarm dropdown returns the latest five while retaining history and counting all unread alarms', async () => {
  const { t, ids, dates, borrower, lender } = await setup()
  const requestId = await value(borrower.mutation(api.borrowing.create, dates))
  for (let i = 1; i <= 7; i++) {
    vi.setSystemTime(Date.now() + 1000)
    await t.run(ctx => enqueue(ctx, { idempotencyKey: `menu-${i}`, recipientId: ids.lender, requestId, title: `Alarm ${i}`, message: 'Update', href: '/incoming-requests' }, false))
  }
  const latest = await lender.query(api.alarms.list, {})
  expect(latest.map(row => row.title)).toEqual(['Alarm 7', 'Alarm 6', 'Alarm 5', 'Alarm 4', 'Alarm 3'])
  expect(await lender.query(api.alarms.unreadCount, {})).toBe(8)
  await lender.mutation(api.alarms.markRead, { alarmId: latest[0].id })
  expect((await lender.query(api.alarms.list, {})).map(row => row.id)).toEqual(latest.map(row => row.id))
  expect(await lender.query(api.alarms.unreadCount, {})).toBe(7)
  expect(await t.run(ctx => ctx.db.query('alarms').take(20))).toHaveLength(8)
})

test('incoming cards get the borrower name only within the authenticated lender view', async () => {
  const { t, ids, dates, borrower, lender, other } = await setup()
  await value(borrower.mutation(api.borrowing.create, dates))
  const incoming = await lender.query(api.workspace.requests, { incoming: true, paginationOpts })
  expect(incoming.page[0].borrowerName).toBe('borrower')
  expect(incoming.page[0]).not.toHaveProperty('email')
  expect(incoming.page[0]).not.toHaveProperty('borrowerId')
  expect((await borrower.query(api.workspace.requests, { incoming: false, paginationOpts })).page[0].borrowerName).toBeNull()
  expect((await other.query(api.workspace.requests, { incoming: true, paginationOpts })).page).toEqual([])
  await expect(t.query(api.workspace.requests, { incoming: true, paginationOpts })).rejects.toThrow('Sign in required')
  await t.run(ctx => ctx.db.delete('users', ids.borrower))
  expect((await lender.query(api.workspace.requests, { incoming: true, paginationOpts })).page[0].borrowerName).toBe('Neighbor')
})
