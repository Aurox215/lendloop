'use client'

import { useEffect, useRef } from 'react'
import { useAuth } from '@clerk/nextjs'
import { toast } from 'sonner'
import Link from 'next/link'
import { Bell, X } from 'lucide-react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useWorkspace } from '../../app/WorkspaceContext'
import { useDismissibleDetails } from '../../hooks/useDismissibleDetails'
import { notifyError } from '../../lib/feedback'

export function NotificationMenu() {
  const { ready } = useWorkspace()
  const { userId } = useAuth()
  const notifications = useQuery(api.alarms.list, ready ? {} : 'skip')
  const unread = useQuery(api.alarms.unreadCount, ready ? {} : 'skip') ?? 0
  const markRead = useMutation(api.alarms.markRead)
  const markAllRead = useMutation(api.alarms.markAllRead).withOptimisticUpdate(store => store.setQuery(api.alarms.unreadCount, {}, 0))
  const previous = useRef<{ userId: string | null | undefined; ids: Set<string> } | null>(null)
  const menu = useRef<HTMLDetailsElement>(null)
  useDismissibleDetails(menu)

  useEffect(() => {
    if (!notifications) return
    const last = previous.current
    if (last && last.userId === userId) {
      for (const alarm of notifications) {
        if (!last.ids.has(alarm.id) && alarm.unread) toast.info(alarm.title, { id: `alarm:${alarm.id}`, description: alarm.message })
      }
    }
    previous.current = { userId, ids: new Set(notifications.map(alarm => alarm.id)) }
  }, [notifications, userId])

  function openRequests() {
    if (menu.current) menu.current.open = false
  }

  return (
    <details ref={menu} className="relative shrink-0" onToggle={event => {
      if (event.currentTarget.open && ready) void markAllRead({}).catch(error => notifyError('alarm.read_all', error, 'Could not mark alarms as read.'))
    }}>
      <summary aria-label="Alarms" className="relative cursor-pointer list-none rounded-full p-2 hover:bg-stone-100 [&::-webkit-details-marker]:hidden">
        <Bell size={22} strokeWidth={1.7} aria-hidden="true" />
        {unread > 0 && <span aria-label={`${unread} unread alarms`} className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs font-semibold leading-5 text-white">{unread > 99 ? '99+' : unread}</span>}
      </summary>
      <div style={{ width: 'min(28rem, calc(100vw - 2rem))' }} className="absolute right-0 z-20 mt-3 max-h-[calc(100dvh-8rem)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-stone-200 bg-white p-4 shadow-lg">
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-semibold">Alarms</h2>
          <button type="button" aria-label="Close alarms" className="rounded p-1 hover:bg-stone-100" onClick={() => {
            if (menu.current) { menu.current.open = false; menu.current.querySelector('summary')?.focus() }
          }}><X size={16} aria-hidden="true" /></button>
        </div>
        {!ready || notifications === undefined ? (
          <p role="status" className="text-sm">Loading…</p>
        ) : notifications.length === 0 ? (
          <p className="text-sm text-stone-500">No alarms.</p>
        ) : notifications.map(item => (
          <Link key={item.id} href={item.href} title={item.message} onClick={() => {
            openRequests()
            void markRead({ alarmId: item.id }).catch(error => notifyError('alarm.read', error, 'Could not mark the alarm as read.'))
          }}
            className="block w-full min-w-0 cursor-pointer rounded p-2 text-left text-sm hover:bg-stone-100">
            <span className={`block line-clamp-2 [overflow-wrap:anywhere] ${item.unread ? 'font-semibold' : ''}`}>{item.title}</span>
            <span className="block line-clamp-2 text-stone-500 [overflow-wrap:anywhere]">{item.message}</span>
          </Link>
        ))}
      </div>
    </details>
  )
}
