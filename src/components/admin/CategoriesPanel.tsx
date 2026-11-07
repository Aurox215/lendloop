'use client'

import { useState } from 'react'
import { useMutation, usePaginatedQuery } from 'convex/react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { notifyError } from '../../lib/feedback'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { CategoryForm } from '../forms/CategoryForm'
import { primaryButtonClassName } from '../forms/FieldLabel'
import { Modal } from '../ui/Modal'
import { ConfirmAction } from '../ui/ConfirmAction'
import { ListStatus, PAGE_SIZE } from '../ui/InfiniteList'

export function CategoriesPanel() {
  const { results, status, loadMore } = usePaginatedQuery(api.categories.list, {}, { initialNumItems: PAGE_SIZE })
  const remove = useMutation(api.categories.remove)
  const setStatus = useMutation(api.categories.setStatus)
  const [pendingId, setPendingId] = useState<Id<'categories'> | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<{ id: Id<'categories'>; name: string; isActive: boolean } | undefined>()
  function close() { setCreating(false); setEditing(undefined) }
  async function changeStatus(id: Id<'categories'>, isActive: boolean) {
    setPendingId(id)
    try {
      await setStatus({ categoryId: id, isActive })
      toast.success(isActive ? 'Category activated.' : 'Category deactivated.')
    } catch (error) {
      notifyError('category.status', error, 'Could not update the category status.')
    } finally { setPendingId(null) }
  }

  return <>
    <button onClick={() => setCreating(true)} className={`${primaryButtonClassName} mb-5 inline-flex items-center gap-2`}><Plus size={16} />New category</button>
    <div className="max-w-full overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <table className="min-w-[480px] text-center text-sm">
        <thead className="border-b bg-stone-50"><tr><th className="w-2/5 px-5 py-4 text-center">Category</th><th className="w-1/5 px-5 py-4 text-center">Status</th><th className="px-5 py-4 text-center">Actions</th></tr></thead>
        <tbody>{results.map(category => <tr key={category.id} className="border-b last:border-0">
          <td className="px-5 py-4"><span className="block truncate font-medium" title={category.name}>{category.name}</span></td>
          <td className="px-5 py-4 text-stone-600"><select value={String(category.isActive)} disabled={pendingId !== null} aria-label={`Status for ${category.name}`}
            onChange={event => void changeStatus(category.id, event.target.value === 'true')} className="w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-left disabled:opacity-50"><option value="true">Active</option><option value="false">Inactive</option></select></td>
          <td className="px-5 py-4"><div className="flex flex-wrap items-center justify-center gap-2">
            <button onClick={() => setEditing(category)} aria-label={`Edit ${category.name}`} className="rounded-lg border border-stone-300 p-2 hover:bg-stone-100"><Pencil size={16} /></button>
            {category.isActive ? <ConfirmAction label="Remove" title="Remove category?" description={`Tools in “${category.name}” will be hidden from the dashboard. Existing loans are preserved.`}
              success="Category removed." operation="category.remove" run={() => remove({ categoryId: category.id })} icon={<Trash2 size={16} />} />
              : null}
          </div></td>
        </tr>)}</tbody>
      </table>
    </div>
    <ListStatus count={results.length} status={status} loadMore={loadMore} />
    {(creating || editing) && <Modal title={editing ? 'Edit category' : 'New category'} onClose={close}><CategoryForm category={editing} onSaved={close} onCancel={close} /></Modal>}
  </>
}
