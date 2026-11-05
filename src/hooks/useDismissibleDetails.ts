'use client'

import { useEffect, type RefObject } from 'react'

export function useDismissibleDetails(ref: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    function outside(event: PointerEvent) {
      const element = ref.current
      if (element?.open && event.target instanceof Node && !element.contains(event.target)) element.open = false
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && ref.current?.open) {
        ref.current.open = false
        ref.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [ref])
}
