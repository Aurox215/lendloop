// Browser-only fixture: exercise the real shared modal without signing in.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Modal } from '../src/components/ui/Modal'
import { ConvexProvider, type ConvexReactClient } from 'convex/react'
import type { Id } from '../convex/_generated/dataModel'
import { RequestActions } from '../src/components/tools/RequestActions'
import { BorrowForm } from '../src/components/tools/BorrowForm'
import { Toaster } from 'sonner'

// No database writes: confirm/cancel behavior uses an isolated client stub.
const decisions: unknown[] = []
const client = { mutation: async (_reference: unknown, args: unknown) => {
  decisions.push(args)
  if (args && typeof args === 'object' && 'clientKey' in args) return { ok: false, code: 'PENDING_OVERLAP', message: 'You already have a pending request for this tool with overlapping dates.' }
  return { ok: true, value: null }
} } as unknown as ConvexReactClient
Object.assign(window, { __layoutDecisions: decisions })

const container = document.createElement('div')
container.id = 'layout-modal-fixture'
document.body.append(container)
const root = createRoot(container)

function Fixture() {
  const [open, setOpen] = useState(false)
  return <>
    <button id="layout-open-modal" onClick={() => setOpen(true)}>Open modal fixture</button>
    <div id="layout-request-actions"><RequestActions requestId={'fixture-request' as Id<'borrowRequests'>} incoming status="pending" loanId={null} loanStatus={null} /></div>
    <div id="layout-return-actions"><RequestActions requestId={'fixture-request' as Id<'borrowRequests'>} incoming status="approved" loanId={'fixture-loan' as Id<'loans'>} loanStatus="active" /></div>
    <div id="layout-borrow-form"><BorrowForm toolId={'fixture-tool' as Id<'tools'>} onClose={() => { throw new Error('Rejected submissions must keep the form open.') }} /></div>
    <Toaster />
    {open && <Modal title="Layout modal fixture" onClose={() => setOpen(false)}><p>Modal positioning and dismissal check.</p></Modal>}
  </>
}

root.render(<ConvexProvider client={client}><Fixture /></ConvexProvider>)
Object.assign(window, { __unmountLayoutFixture: () => { root.unmount(); container.remove() } })
