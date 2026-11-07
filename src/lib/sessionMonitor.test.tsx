import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { monitorSession } from './sessionMonitor'

const now = Date.UTC(2030, 0, 1)
let events: EventTarget
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  events = new EventTarget()
  vi.stubGlobal('window', events)
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function setup(options: { expireAt?: number; token?: string | null; failure?: unknown } = {}) {
  const getToken = options.failure ? vi.fn().mockRejectedValue(options.failure) : vi.fn().mockResolvedValue(options.token === undefined ? 'fresh-token' : options.token)
  const session = { id: 'session-one', status: 'active', expireAt: new Date(options.expireAt ?? now + 120_000), getToken }
  let active: typeof session | null = session
  const onExpired = vi.fn(), onUnavailable = vi.fn()
  const stop = monitorSession({ sessionId: session.id, getSession: () => active, onExpired, onUnavailable })
  return { session, onExpired, onUnavailable, stop, switchSession: () => { active = { ...session, id: 'session-two' } } }
}

test('expired sessions end once without asking for another token', async () => {
  const state = setup({ expireAt: now - 1 })
  events.dispatchEvent(new Event('focus'))
  await vi.advanceTimersByTimeAsync(60_000)
  expect(state.onExpired).toHaveBeenCalledOnce()
  expect(state.session.getToken).not.toHaveBeenCalled()
  state.stop()
})

test('healthy JWT refreshes keep the session alive until its actual expiration', async () => {
  const state = setup({ expireAt: now + 90_000 })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(state.onExpired).not.toHaveBeenCalled()
  expect(state.session.getToken).toHaveBeenCalledWith({ skipCache: true })
  await vi.advanceTimersByTimeAsync(30_000)
  expect(state.onExpired).toHaveBeenCalledOnce()
  state.stop()
})

test('revocation is detected when a sleeping tab regains focus', async () => {
  const state = setup()
  await vi.advanceTimersByTimeAsync(0)
  state.session.status = 'revoked'
  events.dispatchEvent(new Event('focus'))
  expect(state.onExpired).toHaveBeenCalledOnce()
  state.stop()
})

test('explicit Clerk session expiration ends the session', async () => {
  for (const options of [{ failure: { errors: [{ code: 'session_expired' }] } }, { failure: { errors: [{ code: 'session_revoked' }] } }]) {
    const state = setup(options)
    await vi.advanceTimersByTimeAsync(0)
    expect(state.onExpired).toHaveBeenCalledOnce()
    expect(state.onUnavailable).not.toHaveBeenCalled()
    state.stop()
  }
})

test('network, generic 401, and provider failures preserve a healthy session and recover on focus', async () => {
  for (const failure of [new TypeError('Failed to fetch'), { status: 401 }, { status: 503 }, { errors: [{ code: 'unexpected_error' }] }]) {
    const state = setup({ failure })
    await vi.advanceTimersByTimeAsync(0)
    expect(state.onExpired).not.toHaveBeenCalled()
    expect(state.onUnavailable).toHaveBeenCalledOnce()
    state.session.getToken.mockResolvedValue('refreshed')
    events.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(state.onExpired).not.toHaveBeenCalled()
    state.stop()
  }
})

test('a temporarily missing token does not sign out a still-active session', async () => {
  const state = setup({ token: null })
  await vi.advanceTimersByTimeAsync(0)
  expect(state.onExpired).not.toHaveBeenCalled()
  expect(state.onUnavailable).toHaveBeenCalledOnce()
  state.session.getToken.mockResolvedValue('refreshed')
  events.dispatchEvent(new Event('focus'))
  await vi.advanceTimersByTimeAsync(0)
  expect(state.onExpired).not.toHaveBeenCalled()
  state.stop()
})

test('an old refresh response cannot log out a newly selected session or an unmounted guard', async () => {
  for (const switched of [true, false]) {
    let resolve!: (token: null) => void
    const state = setup()
    await vi.advanceTimersByTimeAsync(0)
    state.session.getToken.mockImplementation(() => new Promise(done => { resolve = done }))
    events.dispatchEvent(new Event('focus'))
    if (switched) state.switchSession()
    else state.stop()
    resolve(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(state.onExpired).not.toHaveBeenCalled()
    state.stop()
  }
})

test('a stalled refresh cannot keep an expired session alive', async () => {
  const state = setup({ expireAt: now + 30_000 })
  await vi.advanceTimersByTimeAsync(0)
  state.session.getToken.mockImplementation(() => new Promise(() => {}))
  events.dispatchEvent(new Event('focus'))
  await vi.advanceTimersByTimeAsync(30_000)
  expect(state.onExpired).toHaveBeenCalledOnce()
  state.stop()
})
