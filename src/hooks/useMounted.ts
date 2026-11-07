'use client'

import { useEffect, useRef } from 'react'

// Async work may finish after a dismissible form has been closed.
export function useMounted() {
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  return mounted
}
