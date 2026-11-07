export const TEXT_LIMITS = {
  title: 80,
  category: 40,
  description: 500,
} as const

// Use UTF-16 lengths to match HTML maxLength and the visible form counters.
export function textError(value: string, label: string, limit: number, required = true) {
  if (value.length > limit) return `${label} must be ${limit} characters or fewer.`
  if (required && !value.trim()) return `${label} is required.`
  return null
}
