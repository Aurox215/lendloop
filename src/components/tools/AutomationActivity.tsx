'use client'

import { useState } from 'react'

export function AutomationActivity({ activity }: { activity: { eventType: string; status: string; at: number; error: string | null } | null }) {
  const [now] = useState(() => Date.now())
  if (!activity) return null
  const elapsed = Math.max(0, now - activity.at)
  const unit = elapsed >= 86_400_000 ? 'day' : elapsed >= 3_600_000 ? 'hour' : 'minute'
  const divisor = unit === 'day' ? 86_400_000 : unit === 'hour' ? 3_600_000 : 60_000
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.floor(elapsed / divisor), unit)
  const label = activity.eventType === 'loan.overdue' || activity.eventType === 'overdue_reminder' ? 'Reminder' : 'Notification'
  return <p className={`mt-2 text-xs ${activity.status === 'failed' ? 'text-amber-800' : 'text-stone-500'}`} title={new Date(activity.at).toLocaleString()}>
    {label} {activity.status} {relative}{activity.status === 'failed' ? '. Your request is saved.' : ''}
  </p>
}
