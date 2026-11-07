import assert from 'node:assert/strict'
import { createClerkClient } from '@clerk/backend'

// Development-only diagnostic. Never prints tokens, user identities, cookies, or keys.
process.loadEnvFile('.env.local')
const origin = new URL(process.env.APP_URL ?? 'http://localhost:3000')
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname), 'Use this check only against the local development app.')
assert.ok(process.env.CLERK_SECRET_KEY?.startsWith('sk_test_'), 'This check requires development Clerk keys.')
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY, publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY })

async function check() {
  let token
  for (const user of (await clerk.users.getUserList({ limit: 10 })).data) {
    const session = (await clerk.sessions.getSessionList({ userId: user.id, status: 'active', limit: 1 })).data[0]
    if (!session) continue
    // Mint a short-lived token for an existing active session; don't create/revoke sessions.
    token = (await clerk.sessions.getToken(session.id)).jwt
    break
  }
  assert.ok(token, 'Sign in to the development app first; no active session was available.')
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  const clockOffsetSeconds = Math.round(claims.iat - Date.now() / 1000)
  console.log(JSON.stringify({ event: 'auth.clock_check', clockOffsetSeconds }))
  assert.ok(Math.abs(clockOffsetSeconds) < 10, 'The computer clock differs from Clerk. Synchronize Windows time before testing authentication.')
  for (const path of ['/my-listings', '/my-requests', '/incoming-requests', '/admin/categories', '/admin/loans']) {
    const response = await fetch(new URL(path, origin), { redirect: 'manual', headers: { Authorization: `Bearer ${token}`, Accept: 'text/html' } })
    console.log(JSON.stringify({ path, authenticatedStatus: response.status, authReason: response.headers.get('x-clerk-auth-reason') }))
    await response.text()
    assert.equal(response.status, 200, 'A valid signed-in request must not redirect to sign-in.')
    const anonymous = await fetch(new URL(path, origin), { redirect: 'manual' })
    assert.equal(anonymous.status, 307)
    assert.equal(new URL(anonymous.headers.get('location'), origin).pathname, '/signin')
    await anonymous.text()
  }
  console.log('Signed-in requests are accepted; anonymous protected requests redirect. Admin data permissions remain independently enforced in Convex.')
}

check().catch(error => {
  console.error(JSON.stringify({ event: 'auth.check_failed', errorName: error.name, message: error instanceof assert.AssertionError ? error.message : 'Clerk or the local app could not be reached. Check keys and network.' }))
  process.exitCode = 1
})
