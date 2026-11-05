'use client'

import { useState } from 'react'
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

export function ToolFeed({ categoryId, search, now }: { categoryId?: Id<'categories'>; search: string; now: number }) {
  const { view } = useWorkspace()
  const reference = view === 'my-listings' ? api.catalog.myListings : view === 'remove-tools' ? api.catalog.adminTools : api.catalog.publicTools
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
        </ToolCard>
      ))}
    </InfiniteList>
    {editing && <Modal title="Edit listing" onClose={() => setEditing(null)}><ListingEditor toolId={editing} onClose={() => setEditing(null)} /></Modal>}</>
  )
}

function ListingEditor({ toolId, onClose }: { toolId: Id<'tools'>; onClose: () => void }) {
  const tool = useQuery(api.tools.detail, { toolId })
  if (tool === undefined) return <p role="status">Loading listing…</p>
  if (!tool?.canEdit) return <p role="alert">This listing is unavailable for editing.</p>
  return <ToolForm tool={tool} onSaved={onClose} onCancel={onClose} />
}

export function RequestFeed({ incoming }: { incoming: boolean }) {
  const { results, status, loadMore } = usePaginatedQuery(api.workspace.requests, { incoming }, { initialNumItems: PAGE_SIZE })
  return (
    <InfiniteList status={status} loadMore={loadMore} count={results.length}>
      {results.map(row => (
        <ToolCard key={row.id} tool={{ ...row, id: row.toolId }}>
          <p className="text-sm capitalize">{row.status}</p>
          <p className="mt-1 text-sm text-stone-600 [overflow-wrap:anywhere]">
            {new Date(row.startAt).toLocaleDateString()} – {new Date(row.endAt).toLocaleDateString()}
          </p>
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
        <ToolCard key={row.id} tool={{ ...row, id: row.toolId }}>
          <p className="text-sm capitalize">{row.status}</p>
          <p className="mt-1 text-sm text-stone-600">Due: {new Date(row.dueAt).toLocaleDateString()}</p>
        </ToolCard>
      ))}
    </InfiniteList>
  )
}

