'use client'

import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { BusinessResult } from '../../../shared/result'
import { notifyError } from '../../lib/feedback'
import { primaryButtonClassName, secondaryButtonClassName } from '../forms/FieldLabel'
import { Modal } from '../ui/Modal'

export function RequestActions({ requestId, incoming, status, loanId, loanStatus }: {
  requestId: Id<'borrowRequests'>; incoming: boolean; status: string; loanId: Id<'loans'> | null; loanStatus: string | null
}) {
  const decide = useMutation(api.borrowing.decide)
  const returnLoan = useMutation(api.borrowing.returnLoan)
  const [pending, setPending] = useState(false)
  const [decision, setDecision] = useState<'approved' | 'declined' | 'returned' | null>(null)
  async function confirm() {
    if (!decision) return
    setPending(true)
    try {
      let result: BusinessResult<null>
      if (decision === 'returned') {
        if (!loanId) return
        result = await returnLoan({ loanId })
      } else result = await decide({ requestId, decision })
      if (!result.ok) { toast.warning(result.message); return }
      toast.success(decision === 'returned' ? 'Loan marked returned.' : decision === 'approved' ? 'Request accepted.' : 'Request declined.')
      setDecision(null)
    } catch (error) { notifyError('request.update', error, 'Could not update this request. Try again.') }
    finally { setPending(false) }
  }
  return <div className="mt-4 flex flex-wrap justify-end gap-2">
    {incoming && status === 'pending' && <>
      <button disabled={pending} onClick={() => setDecision('approved')} className={primaryButtonClassName}>Accept</button>
      <button disabled={pending} onClick={() => setDecision('declined')} className={secondaryButtonClassName}>Decline</button>
    </>}
    {incoming && loanId && loanStatus === 'active' && <button disabled={pending} onClick={() => setDecision('returned')} className={secondaryButtonClassName}>Mark Returned</button>}
    {decision && <Modal title={decision === 'returned' ? 'Have you physically received the tool?' : decision === 'approved' ? 'Accept borrow request?' : 'Decline borrow request?'} onClose={() => setDecision(null)}>
      <p className="mb-5 text-sm text-stone-600">{decision === 'returned' ? 'Confirm only after the tool is back in your possession. This will close the loan and update availability.' : decision === 'approved' ? 'Create an active loan and notify the borrower?' : 'Decline this request and notify the borrower?'}</p>
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" onClick={() => setDecision(null)} className={secondaryButtonClassName}>Cancel</button>
        <button disabled={pending} onClick={() => void confirm()} className={primaryButtonClassName}>{pending ? 'Saving…' : decision === 'returned' ? 'Yes, mark returned' : decision === 'approved' ? 'Accept' : 'Decline'}</button>
      </div>
    </Modal>}
  </div>
}
