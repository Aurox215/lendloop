import { SignIn } from '@clerk/nextjs'
import { Suspense } from 'react'

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Suspense fallback={<p role="status">Loading sign-in…</p>}>
        <SignIn routing="path" path="/signin" signUpUrl="/signup" />
      </Suspense>
    </main>
  )
}
