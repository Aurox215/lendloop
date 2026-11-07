'use client'

import { useAuth, UserButton } from '@clerk/nextjs'
import Link from 'next/link'
import { NotificationMenu } from '../components/notifications/NotificationMenu'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'

export default function AuthNavigation() {
  const { isLoaded, isSignedIn } = useAuth()

  return (
    <header className="min-w-0 border-b border-stone-200 bg-white">
      <div className="flex min-h-20 min-w-0 flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <Link href="/" className="shrink-0 text-2xl font-bold tracking-tight text-emerald-800">
          LendLoop<span className="text-amber-500">.</span>
        </Link>
        {!isLoaded ? (
          <span role="status" className="text-sm text-stone-500">Loading account…</span>
        ) : isSignedIn ? (
          <div className="flex shrink-0 items-center gap-4"><ErrorBoundary><NotificationMenu /></ErrorBoundary><UserButton /></div>
        ) : (
          <Link href="/signin" prefetch={false}
            className="max-w-full rounded-full bg-emerald-800 px-5 py-3 text-center text-sm font-medium text-white [overflow-wrap:anywhere] hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
            Sign in to lend or borrow
          </Link>
        )}
      </div>
    </header>
  )
}
