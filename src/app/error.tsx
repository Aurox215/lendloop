'use client'

import { ErrorFallback } from '../components/ui/ErrorBoundary'

export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorFallback error={error} retry={retry} />
}
