'use client'

import { useEffect, useId, useRef, type ReactNode, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef(onClose)
  const titleId = useId()
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement
    element?.showModal()
    return () => {
      element?.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  function outsideClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close.current()
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <dialog ref={dialog} aria-labelledby={titleId} onClick={outsideClick}
      onCancel={event => { event.preventDefault(); close.current() }}
      style={{ margin: 'auto', inset: 0 }}
      className="fixed max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-stone-200 bg-white p-0 shadow-xl backdrop:bg-black/40">
      <div className="p-5 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 id={titleId} className="min-w-0 text-xl font-semibold [overflow-wrap:anywhere]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="shrink-0 rounded-lg p-1 hover:bg-stone-100"><X size={20} aria-hidden="true" /></button>
        </div>
        {children}
      </div>
    </dialog>, document.body,
  )
}
