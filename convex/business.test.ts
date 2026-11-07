import { expect, test, vi } from 'vitest'
import { business } from './business'
import { logged } from './logging'

test('unexpected failures still reject and retain a sanitized error log', async () => {
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
  const failure = new Error('sensitive upstream payload')
  try {
    await expect(logged('test.failure', () => business(async () => { throw failure }))).rejects.toBe(failure)
    expect(logger).toHaveBeenCalledOnce()
    expect(JSON.stringify(logger.mock.calls)).toContain('operation.failed')
    expect(JSON.stringify(logger.mock.calls)).not.toContain(failure.message)
  } finally { logger.mockRestore() }
})
