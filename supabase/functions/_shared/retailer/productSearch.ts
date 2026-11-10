// Product search for the Staples screen (rollout phase 4).
//
// searchRetailerProducts() checks the query, checks the user's household may use the
// retailer (member + ah_enabled), runs the search through the household's linked account
// (single-flight token refresh, accountTokens.ts), saves every product it saw in the
// product cache (public.retailer_products) and returns the orderable ones in the
// retailer's order. The database and the retailer sit behind ProductSearchDeps so this is
// testable without either. Each search refreshes the token once, so the screen searches
// on submit, not on every keystroke.

import { RetailerError } from './types.ts'
import type { RetailerProduct } from './types.ts'

export const MIN_QUERY_LENGTH = 2
export const MAX_QUERY_LENGTH = 60
const RESULT_SIZE = 12

export type QueryCheck = { ok: true; query: string } | { ok: false; message: string }

export function checkSearchQuery(raw: unknown): QueryCheck {
  if (typeof raw !== 'string') return { ok: false, message: 'Type what you want to search for.' }
  const query = raw.trim().replace(/\s+/g, ' ')
  if (query.length < MIN_QUERY_LENGTH) return { ok: false, message: `Type at least ${MIN_QUERY_LENGTH} characters.` }
  if (query.length > MAX_QUERY_LENGTH) return { ok: false, message: `Keep the search under ${MAX_QUERY_LENGTH + 1} characters.` }
  return { ok: true, query }
}

export interface ProductRow {
  retailer: string
  external_id: number
  title: string
  sales_unit_size: string | null
  price: number | null
  orderable: boolean
  last_seen_at: string
}

export function toProductRow(retailer: string, p: RetailerProduct, seenAt: string): ProductRow {
  return {
    retailer,
    external_id: p.externalId,
    title: p.title,
    sales_unit_size: p.salesUnitSize,
    price: p.price,
    orderable: p.orderable,
    last_seen_at: seenAt,
  }
}

export interface SearchResult {
  externalId: number
  title: string
  salesUnitSize: string | null
  price: number | null
  /** National bonus label (e.g. "2e GRATIS"), or null. */
  bonus: string | null
}

export function toSearchResult(p: RetailerProduct): SearchResult {
  return {
    externalId: p.externalId,
    title: p.title,
    salesUnitSize: p.salesUnitSize,
    price: p.price,
    bonus: p.promotion?.mechanism ?? null,
  }
}

export interface ProductSearchDeps {
  getHousehold(userId: string): Promise<{ householdId: string; ahEnabled: boolean } | null>
  /** Runs fn with a fresh access token for the household's account (withAccessToken). */
  withToken<T>(householdId: string, fn: (accessToken: string) => Promise<T>): Promise<T>
  search(accessToken: string, query: string, size: number): Promise<RetailerProduct[]>
  saveProducts(rows: ProductRow[]): Promise<void>
  now(): string
  /** Called when the product cache couldn't be updated; the search still succeeds. */
  onCacheError?(error: unknown): void
}

export async function searchRetailerProducts(
  deps: ProductSearchDeps,
  { userId, retailer, query: raw }: { userId: string; retailer: string; query: unknown },
): Promise<{ products: SearchResult[] }> {
  const check = checkSearchQuery(raw)
  if (!check.ok) throw new RetailerError('invalid', check.message)

  const household = await deps.getHousehold(userId)
  if (!household || !household.ahEnabled) {
    throw new RetailerError('forbidden', 'Supermarket features are not switched on for your household')
  }

  const found = await deps.withToken(household.householdId, (token) => deps.search(token, check.query, RESULT_SIZE))

  const unique: RetailerProduct[] = []
  const seen = new Set<number>()
  for (const p of found) {
    if (seen.has(p.externalId)) continue
    seen.add(p.externalId)
    unique.push(p)
  }

  if (unique.length > 0) {
    const seenAt = deps.now()
    try {
      await deps.saveProducts(unique.map((p) => toProductRow(retailer, p, seenAt)))
    } catch (err) {
      deps.onCacheError?.(err)
    }
  }

  return { products: unique.filter((p) => p.orderable).map(toSearchResult) }
}
