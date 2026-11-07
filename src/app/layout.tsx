import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { Geist, Geist_Mono } from 'next/font/google'
import { Suspense } from 'react'
import ConvexClientProvider from './ConvexClientProvider'
import AppShell from './AppShell'
import { FeedbackProvider } from '../components/notifications/FeedbackProvider'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'LendLoop | Neighborhood tool sharing',
  description: "Borrow what you need. Lend what you don't.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <FeedbackProvider />
        <ErrorBoundary>
        <ClerkProvider
          signInUrl="/signin"
          signUpUrl="/signup"
          proxyUrl="/__clerk"
          signInFallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
        >
          <Suspense fallback={<p role="status">Loading LendLoop…</p>}>
            <ConvexClientProvider>
              <AppShell>{children}</AppShell>
            </ConvexClientProvider>
          </Suspense>
        </ClerkProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}
