import Link from 'next/link'
import { useState } from 'react'
import { LayoutDashboard, Package, Send, Inbox, Shield, Trash2, ClipboardList, Users, Tags, ChevronDown, type LucideIcon } from 'lucide-react'
import { useWorkspace, viewNames, viewPaths, type View } from '../../app/WorkspaceContext'

const icons: Record<View, LucideIcon> = {
  dashboard: LayoutDashboard, 'my-listings': Package, 'my-requests': Send,
  'incoming-requests': Inbox, 'remove-tools': Trash2, 'all-loans': ClipboardList,
  'mark-lender': Users, categories: Tags,
}

export function Sidebar({ signedIn }: { signedIn: boolean }) {
  const { view, admin } = useWorkspace()
  const [adminOpen, setAdminOpen] = useState(true)
  const option = (item: View) => {
    const Icon = icons[item]
    return (
    <Link key={item} href={viewPaths[item]} prefetch={false} aria-current={view === item ? 'page' : undefined}
      className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium [overflow-wrap:anywhere] ${view === item ? 'bg-emerald-800 text-white' : 'text-stone-600 hover:bg-stone-100'}`}>
      <Icon size={18} className="shrink-0" aria-hidden="true" /><span>{viewNames[item]}</span>
    </Link>
    )
  }

  return (
    <aside className="min-w-0 shrink-0 border-b border-stone-200 bg-white p-4 md:sticky md:top-0 md:h-[calc(100dvh-81px)] md:w-60 md:overflow-y-auto md:border-r md:border-b-0">
      <nav aria-label="Main navigation" className="space-y-1">
        {option('dashboard')}
        {signedIn && <>{option('my-listings')}{option('my-requests')}{option('incoming-requests')}</>}
        {admin && signedIn && (
          <details open={adminOpen} onToggle={event => setAdminOpen(event.currentTarget.open)} className="group pt-3">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden"><Shield size={18} aria-hidden="true" />Admin<ChevronDown size={16} className="ml-auto transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
            <div className="space-y-1 pl-3">{option('categories')}{option('remove-tools')}{option('all-loans')}{option('mark-lender')}</div>
          </details>
        )}
      </nav>
    </aside>
  )
}
