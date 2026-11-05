// Highest matching field determines priority; Convex relevance breaks ties.
export const SEARCH_WEIGHTS = { name: 3, description: 2, condition: 1 } as const

function tokens(text: string) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => word.length <= 32)
}

export function normalizeSearch(search: string) {
  return tokens(search).slice(0, 16).join(' ')
}

export function searchWeight(tool: { name: string; description: string; condition: string }, search: string) {
  const terms = tokens(normalizeSearch(search))
  if (terms.length === 0) return 0
  const matches = (value: string) => {
    const words = tokens(value)
    return terms.some((term, index) => words.some(word => index === terms.length - 1 ? word.startsWith(term) : word === term))
  }
  if (matches(tool.name)) return SEARCH_WEIGHTS.name
  if (matches(tool.description)) return SEARCH_WEIGHTS.description
  if (matches(tool.condition.replaceAll('_', ' '))) return SEARCH_WEIGHTS.condition
  return 0
}
