type Session = {
  id: string
  status: string
  expireAt: Date
  getToken: (options: { skipCache: boolean }) => Promise<string | null>
}

const terminalStatuses = new Set(['expired', 'revoked', 'ended', 'removed', 'replaced', 'abandoned'])
const terminalCodes = new Set(['session_expired', 'session_revoked', 'session_ended', 'session_not_found', 'session_invalid', 'session_not_active'])

function isAuthenticationFailure(error: unknown) {
  if (!error || typeof error !== 'object') return false
  return 'errors' in error && Array.isArray(error.errors) && error.errors.some((entry: unknown) =>
    !!entry && typeof entry === 'object' && 'code' in entry && typeof entry.code === 'string' && terminalCodes.has(entry.code))
}

// Check the session, not a cached JWT's exp: healthy short-lived tokens refresh normally.
export function monitorSession({ sessionId, getSession, onExpired, onUnavailable }: {
  sessionId: string
  getSession: () => Session | null | undefined
  onExpired: () => void
  onUnavailable: (error: unknown) => void
}) {
  let stopped = false
  let checking = false
  let finished = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  const current = () => !stopped && getSession()?.id === sessionId
  function expire() {
    if (!current() || finished) return
    finished = true
    clearTimeout(timer)
    clearTimeout(deadline)
    onExpired()
  }
  function watchDeadline() {
    clearTimeout(deadline)
    if (!current() || finished) return
    const remaining = getSession()!.expireAt.getTime() - Date.now()
    if (remaining <= 0) { expire(); return }
    deadline = setTimeout(watchDeadline, Math.min(2_147_483_647, remaining))
  }
  async function check() {
    if (!current() || finished || checking) return
    checking = true
    clearTimeout(timer)
    try {
      const session = getSession()!
      if (terminalStatuses.has(session.status) || session.expireAt.getTime() <= Date.now()) { expire(); return }
      watchDeadline()
      const token = await session.getToken({ skipCache: true })
      if (!token && current()) onUnavailable(new Error('Session token refresh did not return a token.'))
    } catch (error) {
      if (!current()) return
      if (isAuthenticationFailure(error)) expire()
      else onUnavailable(error)
    } finally {
      checking = false
      if (current() && !finished) {
        const remaining = getSession()!.expireAt.getTime() - Date.now()
        timer = setTimeout(() => void check(), Math.max(1000, Math.min(60_000, remaining)))
      }
    }
  }
  const resume = () => { if (document.visibilityState !== 'hidden') void check() }
  window.addEventListener('focus', resume)
  window.addEventListener('online', resume)
  document.addEventListener('visibilitychange', resume)
  void check()
  return () => {
    stopped = true
    clearTimeout(timer)
    clearTimeout(deadline)
    window.removeEventListener('focus', resume)
    window.removeEventListener('online', resume)
    document.removeEventListener('visibilitychange', resume)
  }
}
