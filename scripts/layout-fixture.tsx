// Browser-only fixture: exercise the real shared modal without signing in.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Modal } from '../src/components/ui/Modal'

const container = document.createElement('div')
container.id = 'layout-modal-fixture'
document.body.append(container)
const root = createRoot(container)

function Fixture() {
  const [open, setOpen] = useState(false)
  return <>
    <button id="layout-open-modal" onClick={() => setOpen(true)}>Open modal fixture</button>
    {open && <Modal title="Layout modal fixture" onClose={() => setOpen(false)}><p>Modal positioning and dismissal check.</p></Modal>}
  </>
}

root.render(<Fixture />)
Object.assign(window, { __unmountLayoutFixture: () => { root.unmount(); container.remove() } })
