import { ConvexError } from 'convex/values'
import { textError } from '../shared/textLimits'

export function validatedText(value: string, label: string, limit: number, required = true) {
  const error = textError(value, label, limit, required)
  if (error) throw new ConvexError(error)
  return value.trim()
}
