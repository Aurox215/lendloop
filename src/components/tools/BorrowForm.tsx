'use client'

import { useState, type FormEvent } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { fieldClassName, primaryButtonClassName, secondaryButtonClassName } from '../forms/FieldLabel'
import { notifyError } from '../../lib/feedback'
import { useMounted } from '../../hooks/useMounted'

export function BorrowForm({ toolId, onClose }: { toolId: Id<'tools'>; onClose: () => void }) {
  const create = useMutation(api.borrowing.create)
  const [clientKey] = useState(() => crypto.randomUUID())
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const mounted = useMounted()
  const today = new Date().toISOString().slice(0, 10)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!start || !end || end < start) { setError('Choose a valid date range.'); return }
    setPending(true)
    setError('')
    try {
      const result = await create({ toolId, startAt: Date.parse(`${start}T00:00:00Z`), endAt: Date.parse(`${end}T00:00:00Z`) + 86_400_000, clientKey })
      if (!result.ok) { toast.warning(result.message); if (mounted.current) setError(result.message); return }
      toast.success('Borrow request sent.')
      if (mounted.current) onClose()
    } catch (cause) {
      const message = notifyError('request.create', cause, 'Could not send the borrow request. Try again.')
      if (mounted.current) setError(message)
    } finally { if (mounted.current) setPending(false) }
  }
  return <form onSubmit={submit} className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-medium">From<input type="date" value={start} min={today} required disabled={pending} onChange={event => setStart(event.target.value)} className={`${fieldClassName} mt-2`} /></label>
      <label className="block text-sm font-medium">End<input type="date" value={end} min={start || today} required disabled={pending} onChange={event => setEnd(event.target.value)} className={`${fieldClassName} mt-2`} /></label>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex flex-col-reverse gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:justify-end">
      <button type="button" onClick={onClose} className={secondaryButtonClassName}>Cancel</button>
      <button disabled={pending} className={primaryButtonClassName}>{pending ? 'Sending…' : 'Borrow'}</button>
    </div>
  </form>
}
