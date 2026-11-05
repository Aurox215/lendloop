'use client'

import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Modal } from './Modal'
import { notifyError } from '../../lib/feedback'
import { secondaryButtonClassName } from '../forms/FieldLabel'

export function ConfirmAction({ label, title, description, success, operation, run, icon }: {
  label: string; title: string; description: string; success: string; operation: string
  run: () => Promise<unknown>; icon?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function confirm() {
    setPending(true)
    setError('')
    try {
      await run()
      toast.success(success)
      setOpen(false)
    } catch (cause) {
      setError(notifyError(operation, cause, 'Could not remove this item. Try again.'))
    } finally { setPending(false) }
  }
  return <>
    <button type="button" disabled={pending} onClick={() => { setError(''); setOpen(true) }} className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100 disabled:opacity-50">{icon}{label}</button>
    {open && <Modal title={title} onClose={() => setOpen(false)}>
      <p className="mb-6 text-sm leading-6 text-stone-600 [overflow-wrap:anywhere]">{description}</p>
      {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" onClick={() => setOpen(false)} className={secondaryButtonClassName}>Cancel</button>
        <button type="button" disabled={pending} onClick={confirm} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50">{pending ? 'Removing…' : label}</button>
      </div>
    </Modal>}
  </>
}
