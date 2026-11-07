'use client'

import { useAuth } from '@clerk/nextjs'
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { api } from '../../convex/_generated/api'
import { WorkspaceContext, viewPaths, type View } from './WorkspaceContext'
import AuthNavigation from './AuthNavigation'
import { Sidebar } from '../components/board/Sidebar'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'
import { notifyError } from '../lib/feedback'
import { ConnectionStatus } from '../components/notifications/ConnectionStatus'

export default function AppShell({ children }: { children: ReactNode }) {
  const { isSignedIn, userId } = useAuth()
  const { isAuthenticated } = useConvexAuth()
  const ensureUser = useMutation(api.accounts.ensureUser)
  const syncEmail = useAction(api.accounts.syncEmail)
  const viewer = useQuery(api.accounts.viewer, isAuthenticated ? {} : 'skip')
  const [error, setError] = useState('')
  const pathname = usePathname()
  const view = (Object.keys(viewPaths) as View[]).find(item => viewPaths[item] === pathname) ?? 'dashboard'
  const boardPage = Object.values(viewPaths).includes(pathname) || pathname.startsWith('/tools/')
  const admin = viewer?.role === 'admin'
  const ready = isAuthenticated && !!viewer

  const initializeAccount = useCallback(() => Promise.resolve()
    .then(() => ensureUser({}))
    .then(() => syncEmail({}))
    .then(() => setError(''))
    .catch(cause => setError(notifyError('account.initialize', cause, 'Could not load your account. Try again.'))), [ensureUser, syncEmail])

  useEffect(() => {
    if (isAuthenticated) void initializeAccount()
  }, [isAuthenticated, userId, initializeAccount])

  return (
    <WorkspaceContext value={{ view, ready, admin: !!admin }}>
      <AuthNavigation />
      <ConnectionStatus />
      <div className="flex flex-1 flex-col md:flex-row">
        {boardPage && <Sidebar signedIn={!!isSignedIn} />}
        <div className="flex min-w-0 flex-1 flex-col">
          {error && <div role="alert" className="flex flex-wrap items-center gap-3 p-4 text-sm text-red-700 [overflow-wrap:anywhere]"><p>{error}</p><button onClick={initializeAccount} className="underline">Try again</button></div>}
          <ErrorBoundary key={pathname}>{children}</ErrorBoundary>
        </div>
      </div>
    </WorkspaceContext>
  )
}
