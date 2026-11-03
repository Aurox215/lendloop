'use client'

import { useAuth } from '@clerk/nextjs'
import { ConvexReactClient } from 'convex/react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { useState, type ReactNode } from 'react'

export default function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [convex] = useState(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL

    if (!url) {
      throw new Error('Set NEXT_PUBLIC_CONVEX_URL in .env.local before starting LendLoop.')
    }

    return new ConvexReactClient(url)
  })

  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  )
}
