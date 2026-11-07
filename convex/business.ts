import { v, type GenericValidator } from 'convex/values'
import type { BusinessResult } from '../shared/result'
import { textError } from '../shared/textLimits'

export const failureValidator = v.object({ ok: v.literal(false), code: v.string(), message: v.string() })
export const resultValidator = <T extends GenericValidator>(value: T) => v.union(v.object({ ok: v.literal(true), value }), failureValidator)

class BusinessValidation extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

export function reject(code: string, message: string): never { throw new BusinessValidation(code, message) }

export function businessText(value: string, label: string, limit: number) {
  const message = textError(value, label, limit)
  if (message) reject('INVALID_TEXT', message)
  return value.trim()
}

// Only expected business outcomes are converted; auth and unexpected faults still throw.
export async function business<T>(run: () => Promise<T>): Promise<BusinessResult<T>> {
  try { return { ok: true, value: await run() } }
  catch (error) {
    if (!(error instanceof BusinessValidation)) throw error
    console.info(JSON.stringify({ event: 'validation.rejected', code: error.code }))
    return { ok: false, code: error.code, message: error.message }
  }
}
