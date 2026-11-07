import { ConvexError } from 'convex/values'
import { toast } from 'sonner'

const references = new WeakMap<object, string>()

export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.') {
  if (error instanceof ConvexError && typeof error.data === 'string') return error.data
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) return 'Connection failed. Check your connection and retry.'
  return fallback
}

export function logClientError(operation: string, error: unknown) {
  if (error && typeof error === 'object') {
    const previous = references.get(error)
    if (previous) return previous
  }
  const reference = crypto.randomUUID()
  if (error && typeof error === 'object') references.set(error, reference)
  console.error(JSON.stringify({
    event: 'client.error', operation, reference,
    errorName: error instanceof Error ? error.name : 'UnknownError',
    message: friendlyError(error, 'Unexpected client failure'),
    frames: error instanceof Error ? error.stack?.split('\n').filter(line => /^\s+at /.test(line)).slice(0, 6) : undefined,
  }))
  return reference
}

export function notifyError(operation: string, error: unknown, fallback?: string) {
  const reference = logClientError(operation, error)
  const message = friendlyError(error, fallback)
  toast.error(message, { id: reference, description: error instanceof ConvexError ? undefined : `Reference: ${reference.slice(0, 8)}` })
  return message
}
