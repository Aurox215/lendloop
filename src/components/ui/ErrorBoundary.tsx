'use client'

import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { friendlyError, logClientError } from '../../lib/feedback'

export function ErrorFallback({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    const reference = logClientError('render.failed', error)
    toast.error(friendlyError(error, 'Could not load this section.'), { id: reference })
  }, [error])
  return <section role="alert" className="m-5 min-w-0 rounded-xl border border-red-200 bg-white p-6">
    <div className="mb-3 flex items-center gap-2"><AlertCircle size={20} className="shrink-0 text-red-700" /><h2 className="font-semibold">This section could not load.</h2></div>
    <p className="mb-4 text-sm text-stone-600 [overflow-wrap:anywhere]">{friendlyError(error, 'Your data is safe. Try again or return to the dashboard.')}</p>
    <div className="flex flex-wrap gap-4">
      <button onClick={retry} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><RefreshCw size={16} />Try again</button>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Also reset failed root providers when navigating to the dashboard. */}
      <a href="/" className="self-center text-sm underline">Dashboard</a>
    </div>
  </section>
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; error: unknown }> {
  state = { failed: false, error: null as unknown }
  static getDerivedStateFromError(error: unknown) { return { failed: true, error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    logClientError(`boundary${info.componentStack?.split('\n')[1] ?? ''}`, error)
  }
  render() {
    return this.state.failed
      ? <ErrorFallback error={this.state.error} retry={() => this.setState({ failed: false, error: null })} />
      : this.props.children
  }
}
