import { expect, test } from 'vitest'
import { isPublicPath } from './routes'

test('only explicit public resources bypass page authentication', () => {
  for (const path of ['/', '/signin', '/signin/factor-one', '/signup', '/signup/verify-email-address', '/favicon.ico', '/_next/static/chunk.js', '/__clerk/v1/client']) expect(isPublicPath(path)).toBe(true)
  for (const path of ['/my-listings', '/my-requests', '/incoming-requests', '/admin', '/tools/id', '/tools/id.svg', '/api/private', '/signup-admin', '/signin-private']) expect(isPublicPath(path)).toBe(false)
})
