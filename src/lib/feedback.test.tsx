import { afterEach, expect, test, vi } from 'vitest'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'
import { friendlyError, logClientError, notifyError } from './feedback'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

test('business errors are shown exactly while unexpected internals are hidden', () => {
  expect(friendlyError(new ConvexError('You cannot change your own permissions.'))).toBe('You cannot change your own permissions.')
  expect(friendlyError(new Error('Database internals: secret'), 'Could not save.')).toBe('Could not save.')
  expect(friendlyError(new TypeError('Failed to fetch'))).toContain('Connection failed')
})

test('failure notifications carry a reference without logging raw error payloads', () => {
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
  const error = new Error('SensitiveDatabaseValue')
  expect(notifyError('tool.create', error, 'Could not create the listing.')).toBe('Could not create the listing.')
  expect(logger).toHaveBeenCalledTimes(1)
  const record = JSON.parse(logger.mock.calls[0][0])
  expect(record).toMatchObject({ event: 'client.error', operation: 'tool.create', errorName: 'Error' })
  expect(JSON.stringify(record)).not.toContain('SensitiveDatabaseValue')
  expect(toast.error).toHaveBeenCalledWith('Could not create the listing.', expect.objectContaining({ id: record.reference }))
})

test('the same failure keeps one reference across overlapping error boundaries', () => {
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
  const error = new Error('Failure')
  const first = logClientError('boundary', error)
  expect(logClientError('window.error', error)).toBe(first)
  expect(logger).toHaveBeenCalledTimes(1)
})
