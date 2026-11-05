'use client'

import { useEffect } from 'react'
import { logClientError } from '../lib/feedback'

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { logClientError('root.failed', error) }, [error])
  return <html lang="en"><body style={{ fontFamily: 'sans-serif', padding: '2rem', overflowWrap: 'anywhere' }}>
    <h1>LendLoop</h1><p>The application could not load. Please try again.</p>
    <button onClick={retry}>Try again</button>{' '}
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Recover broken root providers with a full document navigation. */}
    <a href="/">Dashboard</a>
  </body></html>
}
