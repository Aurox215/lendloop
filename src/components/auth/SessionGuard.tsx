'use client'

import { useClerk, useSession } from '@clerk/nextjs'
import { useConvex } from 'convex/react'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { isPublicPath } from '../../../shared/routes'
import { monitorSession } from '../../lib/sessionMonitor'
import { logClientError } from '../../lib/feedback'

export function SessionGuard({ children }: { children: ReactNode }) {
  const clerk = useClerk()
  const { isLoaded, session } = useSession()
  const convex = useConvex()
  const pathname = usePathname()
  const ending = useRef<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const sessionId = session?.id

  useEffect(() => {
    if (!isLoaded || sessionId) return
    convex.clearAuth()
    if (!isPublicPath(pathname)) window.location.replace('/signin')
  }, [convex, isLoaded, sessionId, pathname])

  useEffect(() => {
    if (!isLoaded || !sessionId) return
    return monitorSession({
      sessionId,
      getSession: () => clerk.session,
      onExpired: () => {
        if (ending.current === sessionId) return
        ending.current = sessionId
        setLeaving(true)
        convex.clearAuth()
        toast.info('Your session expired. Please sign in again.', { id: 'session-expired' })
        console.info(JSON.stringify({ event: 'session.expired' }))
        void clerk.signOut({ sessionId, redirectUrl: '/signin' }).catch(error => {
          logClientError('session.sign_out', error)
        }).finally(() => { window.location.replace('/signin') })
      },
      onUnavailable: error => {
        // A network error or provider outage does not prove the session is invalid.
        console.warn(JSON.stringify({ event: 'session.check_unavailable', errorName: error instanceof Error ? error.name : 'UnknownError' }))
      },
    })
  }, [clerk, convex, isLoaded, sessionId])

  if (leaving || (isLoaded && !sessionId && !isPublicPath(pathname))) return <p role="status" className="p-5">Redirecting to sign in…</p>
  return children
}
