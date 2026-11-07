'use client'

import { useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { toast } from 'sonner'
import type { Id } from '../../../convex/_generated/dataModel'
import { useWorkspace } from '../../app/WorkspaceContext'
import { Modal } from '../ui/Modal'
import { primaryButtonClassName } from '../forms/FieldLabel'
import { BorrowForm } from './BorrowForm'

export function BorrowButton({ toolId, name }: { toolId: Id<'tools'>; name: string }) {
  const { isSignedIn } = useAuth()
  const { ready } = useWorkspace()
  const [open, setOpen] = useState(false)
  function borrow() {
    if (!isSignedIn) { toast.info('Sign in to borrow this tool.'); return }
    if (!ready) { toast.info('Your account is still loading. Please try again.'); return }
    setOpen(true)
  }
  return <>
    <button type="button" onClick={borrow} className={primaryButtonClassName}>Borrow</button>
    {open && <Modal title={`Borrow ${name}`} onClose={() => setOpen(false)}><BorrowForm toolId={toolId} onClose={() => setOpen(false)} /></Modal>}
  </>
}

