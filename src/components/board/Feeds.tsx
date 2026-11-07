'use client'

import { useEffect, useState } from 'react'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { Pencil, Trash2 } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useWorkspace } from '../../app/WorkspaceContext'
import { ToolCard } from '../tools/ToolCard'
import { ConfirmAction } from '../ui/ConfirmAction'
import { InfiniteList, PAGE_SIZE } from '../ui/InfiniteList'
import { Modal } from '../ui/Modal'
import { ToolForm } from '../tools/ToolForm'
import { ToolBorrowAction } from '../tools/ToolBorrowAction'
import { RequestActions } from '../tools/RequestActions'
import { AutomationActivity } from '../tools/AutomationActivity'
import { notifyError } from '../../lib/feedback'

export function ToolFeed({ categoryId, search, now }: { categoryId?: Id<'categories'>; search: string; now: number }) {
  const { view, ready } = useWorkspace()
  const reference = view === 'my-listings' ? api.catalog.myListings : view === 'remove-tools' ? api.catalog.adminTools : ready ? api.catalog.memberTools : api.catalog.publicTools
  const { results, status, loadMore } = usePaginatedQuery(reference, { categoryId, search, now }, { initialNumItems: PAGE_SIZE })
  const remove = useMutation(api.workspace.removeTool)
  const removeOwn = useMutation(api.tools.remove)
  const [editing, setEditing] = useState<Id<'tools'> | null>(null)

  return (
    <><InfiniteList status={status} loadMore={loadMore} count={results.length}>
      {results.map(tool => (
        <ToolCard key={tool.id} tool={tool}>
          {(view === 'remove-tools' || view === 'my-listings') && <div className="flex flex-wrap gap-2">
            {view === 'my-listings' && <button type="button" onClick={() => setEditing(tool.id)} className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100"><Pencil size={16} />Edit</button>}
            <ConfirmAction label="Remove" title="Remove tool?" description={`Remove “${tool.name}” from the board? Existing requests and loans are preserved.`}
              success="Tool removed." operation="tool.remove" icon={<Trash2 size={16} />}
              run={() => view === 'remove-tools' ? remove({ toolId: tool.id }) : removeOwn({ toolId: tool.id })} />
          </div>}
          <div className="mt-3 flex justify-end"><ToolBorrowAction tool={tool} /></div>
        </ToolCard>
      ))}
    </InfiniteList>
    {editing && <Modal title="Edit listing" onClose={() => setEditing(null)}><ListingEditor toolId={editing} onClose={() => setEditing(null)} /></Modal>}</>
  )
}

function ListingEditor({ toolId, onClose }: { toolId: Id<'tools'>; onClose: () => void }) {
  const [now] = useState(() => Date.now())
  const tool = useQuery(api.tools.detail, { toolId, now })
  if (tool === undefined) return <p role="status">Loading listing…</p>
  if (!tool?.canEdit) return <p role="alert">This listing is unavailable for editing.</p>
  return <ToolForm tool={tool} onSaved={onClose} onCancel={onClose} />
}

export function RequestFeed({ incoming }: { incoming: boolean }) {
  const [now] = useState(() => Date.now())
  const { results, status, loadMore } = usePaginatedQuery(api.workspace.requests, { incoming }, { initialNumItems: PAGE_SIZE })
  const unread = useQuery(api.alarms.unreadCount, {})
  const consume = useMutation(api.alarms.consumeRequests)
  const visibleIds = results.map(row => row.id).join(',')
  useEffect(() => {
    if (!visibleIds) return
    const requestIds = visibleIds.split(',') as Id<'borrowRequests'>[]
    for (let i = 0; i < requestIds.length; i += 100) void consume({ requestIds: requestIds.slice(i, i + 100), incoming }).catch(error => notifyError('alarm.consume', error, 'Could not mark viewed alarms as read.'))
  }, [visibleIds, unread, incoming, consume])
  return (
    <InfiniteList status={status} loadMore={loadMore} count={results.length}>
      {results.map(row => (
        <ToolCard key={row.id} tool={row}>
          <p className="text-sm capitalize">{row.status}</p>
          {incoming && row.borrowerName && <p className="mt-2 text-sm text-stone-600 [overflow-wrap:anywhere]">Borrower: {row.borrowerName}</p>}
          <p className="mt-1 text-sm text-stone-600 [overflow-wrap:anywhere]">
            {new Date(row.startAt).toLocaleDateString(undefined, { timeZone: 'UTC' })} – {new Date(row.endAt - 86_400_000).toLocaleDateString(undefined, { timeZone: 'UTC' })}
          </p>
          {row.loanStatus && <p className="mt-2 text-sm capitalize text-stone-600">Loan: {row.loanStatus === 'active' && row.dueAt && row.dueAt < now ? 'overdue' : row.loanStatus}</p>}
          {row.dueAt && <p className="mt-1 text-sm text-stone-600">Return by: {new Date(row.dueAt - 86_400_000).toLocaleDateString(undefined, { timeZone: 'UTC' })}</p>}
          <AutomationActivity activity={row.activity} />
          <RequestActions requestId={row.id} incoming={incoming} status={row.status} loanId={row.loanId} loanStatus={row.loanStatus} />
        </ToolCard>
      ))}
    </InfiniteList>
  )
}

export function LoanFeed() {
  const { results, status, loadMore } = usePaginatedQuery(api.workspace.loans, {}, { initialNumItems: PAGE_SIZE })
  return (
    <InfiniteList status={status} loadMore={loadMore} count={results.length}>
      {results.map(row => (
        <ToolCard key={row.id} tool={row}>
          <p className="text-sm capitalize">{row.status}</p>
          <p className="mt-1 text-sm text-stone-600">Due: {new Date(row.dueAt).toLocaleDateString()}</p>
          <AutomationActivity activity={row.activity} />
        </ToolCard>
      ))}
    </InfiniteList>
  )
}

