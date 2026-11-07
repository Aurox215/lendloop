'use client'

import { useAuth } from '@clerk/nextjs'
import { useQuery } from 'convex/react'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { WorkspaceContext, useWorkspace, viewNames, type View } from './WorkspaceContext'
import { BoardFilters } from '../components/board/BoardFilters'
import { LoanFeed, RequestFeed, ToolFeed } from '../components/board/Feeds'
import { CategoriesPanel } from '../components/admin/CategoriesPanel'
import { UsersPanel } from '../components/admin/UsersPanel'
import { Modal } from '../components/ui/Modal'
import { ToolForm } from '../components/tools/ToolForm'
import { primaryButtonClassName } from '../components/forms/FieldLabel'

export default function ToolBoard({ view }: { view: View }) {
  const workspace = useWorkspace()
  return <WorkspaceContext value={{ ...workspace, view }}><BoardContent key={view} /></WorkspaceContext>
}

function BoardContent() {
  const { isLoaded, isSignedIn } = useAuth()
  const { view, ready, admin } = useWorkspace()
  const categories = useQuery(api.catalog.categories)
  const [categoryId, setCategoryId] = useState<Id<'categories'> | undefined>()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [now] = useState(() => Date.now())
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  const toolView = view === 'dashboard' || view === 'my-listings' || view === 'remove-tools'
  const showSearch = view === 'dashboard' || view === 'remove-tools'
  const activeSearch = showSearch ? debouncedSearch : ''
  const key = `${view}-${categoryId ?? ''}-${activeSearch}`

  if (isLoaded && !isSignedIn && view !== 'dashboard') return <main className="p-8">Sign in required.</main>
  if (ready && !admin && ['remove-tools', 'all-loans', 'mark-lender', 'categories'].includes(view)) {
    return <main className="p-8" role="alert">Admin access required.</main>
  }

  return (
    <main className="w-full min-w-0 flex-1 px-5 py-8 sm:px-8">
      {isLoaded && !isSignedIn && (
        <div className="mb-8 max-w-full overflow-x-auto">
          <p className="whitespace-nowrap text-xl font-medium tracking-tight sm:text-2xl">Borrow what you need. Lend what you don&apos;t.</p>
        </div>
      )}
      <div className="mb-6 flex min-w-0 flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{viewNames[view]}</h1>
        {view === 'my-listings' && ready && <button onClick={() => setCreating(true)} className={`${primaryButtonClassName} inline-flex items-center gap-2`}><Plus size={16} />New listing</button>}
      </div>
      {toolView && <BoardFilters search={search} onSearch={setSearch} categoryId={categoryId} onCategory={setCategoryId}
        categories={categories ?? []} showSearch={showSearch} />}
      {view !== 'dashboard' && !ready ? (
        <p role="status">Loading account…</p>
      ) : toolView ? (
        <ToolFeed key={key} categoryId={categoryId} search={activeSearch} now={now} />
      ) : view === 'my-requests' || view === 'incoming-requests' ? (
        <RequestFeed key={key} incoming={view === 'incoming-requests'} />
      ) : admin && view === 'all-loans' ? (
        <LoanFeed key={key} />
      ) : admin && view === 'mark-lender' ? (
        <UsersPanel />
      ) : admin && view === 'categories' ? (
        <CategoriesPanel />
      ) : null}
      {creating && <Modal title="New listing" onClose={() => setCreating(false)}><ToolForm onSaved={() => setCreating(false)} onCancel={() => setCreating(false)} /></Modal>}
    </main>
  )
}
