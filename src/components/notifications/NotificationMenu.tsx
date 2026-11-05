'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { Bell, X } from 'lucide-react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useWorkspace } from '../../app/WorkspaceContext'
import { useDismissibleDetails } from '../../hooks/useDismissibleDetails'

export function NotificationMenu() {
  const { ready } = useWorkspace()
  const notifications = useQuery(api.workspace.notifications, ready ? {} : 'skip')
  const menu = useRef<HTMLDetailsElement>(null)
  useDismissibleDetails(menu)

  function openRequests() {
    if (menu.current) menu.current.open = false
  }

  return (
    <details ref={menu} className="relative shrink-0">
      <summary aria-label="Notifications" className="relative cursor-pointer list-none rounded-full p-2 hover:bg-stone-100 [&::-webkit-details-marker]:hidden">
        <Bell size={22} strokeWidth={1.7} aria-hidden="true" />
        {!!notifications?.length && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-600" />}
      </summary>
      <div className="absolute right-0 z-20 mt-3 max-h-[calc(100dvh-8rem)] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-stone-200 bg-white p-4 shadow-lg">
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-semibold">Notifications</h2>
          <button type="button" aria-label="Close notifications" className="rounded p-1 hover:bg-stone-100" onClick={() => {
            if (menu.current) { menu.current.open = false; menu.current.querySelector('summary')?.focus() }
          }}><X size={16} aria-hidden="true" /></button>
        </div>
        {!ready || notifications === undefined ? (
          <p role="status" className="text-sm">Loading…</p>
        ) : notifications.length === 0 ? (
          <p className="text-sm text-stone-500">No notifications.</p>
        ) : notifications.map(item => (
          <Link key={item.id} href="/incoming-requests" title={item.name} onClick={openRequests}
            className="block w-full min-w-0 cursor-pointer rounded p-2 text-left text-sm hover:bg-stone-100">
            <span className="line-clamp-2 [overflow-wrap:anywhere]">{item.name}</span>
            <span className="text-stone-500">Pending request</span>
          </Link>
        ))}
      </div>
    </details>
  )
}
