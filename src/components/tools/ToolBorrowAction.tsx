'use client'

import type { Id } from '../../../convex/_generated/dataModel'
import { BorrowButton } from './BorrowButton'

const labels: Record<string, string> = {
  available: 'Available', pending: 'Pending approval',
  borrowed: 'Borrowed', overdue: 'Overdue', unavailable: 'Unavailable',
}

export function ToolBorrowAction({ tool }: { tool: {
  id: Id<'tools'>; name: string; isOwner?: boolean; canBorrow?: boolean; availability?: string
} }) {
  const state = tool.availability ?? 'available'
  if (state !== 'available' || tool.isOwner || tool.canBorrow === false) {
    const label = labels[tool.canBorrow === false && state === 'available' && !tool.isOwner ? 'unavailable' : state] ?? 'Unavailable'
    return <span role="status" className={`inline-flex items-center rounded-full px-3 py-2 text-sm font-medium ${state === 'pending' || state === 'overdue' ? 'bg-amber-50 text-amber-800' : 'bg-stone-100 text-stone-600'}`}>{label}</span>
  }
  return <BorrowButton toolId={tool.id} name={tool.name} />
}
