'use client'

import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { notifyError } from '../../lib/feedback'

export function FeedbackProvider() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => notifyError('window.error', event.error, 'An unexpected error occurred. Try again.')
    const onRejection = (event: PromiseRejectionEvent) => notifyError('promise.unhandled', event.reason, 'An operation failed. Please try again.')
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return <Toaster position="top-right" richColors closeButton expand visibleToasts={4}
    toastOptions={{ classNames: { toast: '!pr-10', closeButton: '!left-auto !right-2 !top-2 !transform-none' } }} />
}
