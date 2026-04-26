import { Keyword } from './store'

export function escapeQueryTerm(term: string) {
  return term.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function buildQueryClause(term: string) {
  const parts = term
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)

  if (parts.length <= 1) {
    return `"${escapeQueryTerm(parts[0] ?? term.trim())}"`
  }

  return `(${parts.map((item) => `+"${escapeQueryTerm(item)}"`).join(' ')})`
}

export function normalizeQueryTerms(terms: string[]) {
  return Array.from(
    new Set(
      terms
        .map((term) => term.trim())
        .filter(Boolean)
    )
  )
}

export function buildQueryFromTerms(terms: string[]) {
  const normalizedTerms = normalizeQueryTerms(terms)
  if (normalizedTerms.length === 0) return ''
  const clauses = normalizedTerms.map((term) => buildQueryClause(term))
  if (clauses.length === 1) return clauses[0]
  return `(${clauses.join(' | ')})`
}

export function buildQueryFromKeywords(keywords: Keyword[]) {
  return buildQueryFromTerms(keywords.map((keyword) => keyword.name))
}
