import { clerkMiddleware } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isPublicPath } from '../shared/routes'

export default clerkMiddleware(async (auth, request) => {
  if (isPublicPath(request.nextUrl.pathname)) return
  const { userId } = await auth()
  if (userId) return
  if (!['GET', 'HEAD'].includes(request.method) || /^\/(api|trpc)(\/|$)/.test(request.nextUrl.pathname)) {
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  }
  return NextResponse.redirect(new URL('/signin', request.url))
}, {
  frontendApiProxy: { enabled: true },
})

export const config = {
  matcher: ['/(.*)'],
}
