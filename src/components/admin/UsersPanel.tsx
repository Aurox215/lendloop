'use client'

import { useState } from 'react'
import { useMutation, usePaginatedQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import { ListStatus, PAGE_SIZE } from '../ui/InfiniteList'
import { notifyError } from '../../lib/feedback'

type UserRow = FunctionReturnType<typeof api.adminUsers.list>['page'][number]

export function UsersPanel() {
  const { results, status, loadMore } = usePaginatedQuery(api.adminUsers.list, {}, { initialNumItems: PAGE_SIZE })
  return <>
    <div className="max-w-full overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <table className="min-w-[660px] text-center text-sm">
        <thead className="border-b bg-stone-50"><tr>{['Name', 'Email', 'Role', 'Trusted lender', 'Status'].map(label => <th key={label} className="px-4 py-4 text-center">{label}</th>)}</tr></thead>
        <tbody>{results.map(user => <UserEditor key={`${user.id}-${user.role}-${user.trusted}-${user.isActive}`} user={user} />)}</tbody>
      </table>
    </div>
    <ListStatus count={results.length} status={status} loadMore={loadMore} />
  </>
}

function UserEditor({ user }: { user: UserRow }) {
  const update = useMutation(api.adminUsers.update)
  const [role, setRole] = useState(user.role)
  const [trusted, setTrusted] = useState(user.trusted)
  const [isActive, setActive] = useState(user.isActive)
  const [pending, setPending] = useState(false)
  async function change(field: 'role' | 'trusted' | 'isActive', value: 'admin' | 'user' | boolean) {
    const previousRole = role
    const previousTrusted = trusted
    const previousActive = isActive
    if (field === 'role') setRole(value as 'admin' | 'user')
    else if (field === 'trusted') setTrusted(value as boolean)
    else setActive(value as boolean)
    setPending(true)
    try {
      await update({ userId: user.id, ...(field === 'role' ? { role: value as 'admin' | 'user' } : field === 'trusted' ? { trusted: value as boolean } : { isActive: value as boolean }) })
      toast.success(field === 'role' ? 'User role updated.' : field === 'trusted' ? 'Trusted lender status updated.' : 'User status updated.')
    } catch (error) {
      setRole(previousRole)
      setTrusted(previousTrusted)
      setActive(previousActive)
      notifyError('user.update', error, 'Could not update this user. Try again.')
    } finally { setPending(false) }
  }
  return <tr className="border-b last:border-0">
    <td className="px-4 py-4"><span className="line-clamp-2 font-medium [overflow-wrap:anywhere]" title={user.name}>{user.name}</span>{!user.canEdit && <span className="text-xs text-stone-500">You</span>}</td>
    <td className="px-4 py-4"><span className="block truncate text-stone-600" title={user.email ?? undefined}>{user.email ?? '—'}</span></td>
    <td className="px-4 py-4"><select aria-label={`Role for ${user.name}`} value={role} disabled={!user.canEdit || pending} onChange={event => void change('role', event.target.value as 'admin' | 'user')}
      className="w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-left disabled:bg-stone-50 disabled:text-stone-600"><option value="user">User</option><option value="admin">Admin</option></select></td>
    <td className="px-4 py-4"><select value={String(trusted)} onChange={event => void change('trusted', event.target.value === 'true')} disabled={!user.canEdit || pending} aria-label={`Trusted lender for ${user.name}`}
      className="w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-left disabled:bg-stone-50 disabled:text-stone-600"><option value="true">Yes</option><option value="false">No</option></select></td>
    <td className="px-4 py-4"><select aria-label={`Status for ${user.name}`} value={String(isActive)} disabled={!user.canEdit || pending}
      onChange={event => void change('isActive', event.target.value === 'true')}
      className="w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-left disabled:bg-stone-50 disabled:text-stone-600"><option value="true">Active</option><option value="false">Inactive</option></select></td>
  </tr>
}
