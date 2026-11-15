// This week's snapshot for the preview (rollout phase 5, docs/adr/0005). Read-only.
//
// getWeekSnapshot() checks the user's household may use the retailer (member +
// ah_enabled), then, with one token refresh (accountTokens.ts):
//   1. reads the household's current shopping list at the retailer, as it is;
//   2. looks up this week's product info for the staples that need a live answer:
//        - search-term staples   → the first orderable product for their term
//        - pinned staples that can stock up on bonus (non-perishable with a weeks
//          limit) → a search by the cached product title, matched by product id, to
//          learn this week's bonus. The adapter has no "product by id" call.
//      Pinned perishable staples and paused staples need nothing live: the browser
//      uses their cached product.
// The staples are read here, on the server, so a caller can't make the function search
// for arbitrary things. Every product seen goes into the product cache
// (public.retailer_products), like a Staples-screen search. Nothing is written to the
// retailer and nothing about the plan is saved: the browser combines this snapshot with
// the planner (src/lib/weekPreview.js).
//
// The database and the retailer sit behind WeekSnapshotDeps so this is testable
// without either.

import { checkSearchQuery, toProductRow } from './productSearch.ts'
import type { ProductRow } from './productSearch.ts'
import { RetailerError } from './types.ts'
import type { RetailerListItem, RetailerProduct } from './types.ts'

/** Most searches per snapshot, to keep the request rate at the retailer low. */
export const MAX_LOOKUPS = 25
const RESULT_SIZE = 12

/** A household_staples row with its cached product title, as far as the lookup needs it. */
export interface SnapshotStaple {
  id: string
  product_external_id: number | null
  product_title: string | null
  search_term: string | null
  perishable: boolean
  max_weeks_stock: number | null
  active: boolean
}

export type StapleLookup = { kind: 'search' | 'pinned'; query: string }

/** What to search for to get this week's answer for a staple, or null if none is needed (or possible). */
export function stapleLookup(staple: SnapshotStaple): StapleLookup | null {
  if (staple.active === false) return null
  if (staple.product_external_id == null) {
    const check = checkSearchQuery(staple.search_term)
    return check.ok ? { kind: 'search', query: check.query } : null
  }
  const canStockUp = !staple.perishable && (staple.max_weeks_stock ?? 0) > 0
  if (!canStockUp) return null
  const check = checkSearchQuery(staple.product_title)
  return check.ok ? { kind: 'pinned', query: check.query } : null
}

/** This week's product for one staple, in the shape buildWeekPreview() takes as liveProducts. */
export interface LiveProduct {
  externalId: number
  title: string
  salesUnitSize: string | null
  price: number | null
  /** National bonus label (e.g. "2e GRATIS"), or null. */
  mechanism: string | null
}

function toLiveProduct(p: RetailerProduct): LiveProduct {
  return {
    externalId: p.externalId,
    title: p.title,
    salesUnitSize: p.salesUnitSize,
    price: p.price,
    mechanism: p.promotion?.mechanism ?? null,
  }
}

export interface WeekSnapshotDeps {
  getHousehold(userId: string): Promise<{ householdId: string; ahEnabled: boolean } | null>
  getStaples(householdId: string): Promise<SnapshotStaple[]>
  /** Runs fn with a fresh access token for the household's account (withAccessToken). */
  withToken<T>(householdId: string, fn: (accessToken: string) => Promise<T>): Promise<T>
  readList(accessToken: string): Promise<RetailerListItem[]>
  search(accessToken: string, query: string, size: number): Promise<RetailerProduct[]>
  saveProducts(rows: ProductRow[]): Promise<void>
  now(): string
  /** Called when the product cache couldn't be updated; the snapshot still succeeds. */
  onCacheError?(error: unknown): void
}

export interface WeekSnapshot {
  list: RetailerListItem[]
  /** Keyed by staple id; staples without an entry use their cached product (or have none). */
  products: Record<string, LiveProduct>
  /** Queries left out because of MAX_LOOKUPS. */
  skippedLookups: number
}

export async function getWeekSnapshot(
  deps: WeekSnapshotDeps,
  { userId, retailer }: { userId: string; retailer: string },
): Promise<WeekSnapshot> {
  const household = await deps.getHousehold(userId)
  if (!household || !household.ahEnabled) {
    throw new RetailerError('forbidden', 'Supermarket features are not switched on for your household')
  }

  // One search per different query, in staple order.
  const staples = await deps.getStaples(household.householdId)
  const wanted: { staple: SnapshotStaple; lookup: StapleLookup; key: string }[] = []
  const queries = new Map<string, string>() // lower-case query → query as first written
  for (const staple of staples) {
    const lookup = stapleLookup(staple)
    if (!lookup) continue
    const key = lookup.query.toLowerCase()
    if (!queries.has(key)) queries.set(key, lookup.query)
    wanted.push({ staple, lookup, key })
  }
  const toSearch = [...queries.entries()].slice(0, MAX_LOOKUPS)
  const skippedLookups = queries.size - toSearch.length

  const { list, found } = await deps.withToken(household.householdId, async (token) => {
    const list = await deps.readList(token)
    const found = new Map<string, RetailerProduct[]>()
    for (const [key, query] of toSearch) found.set(key, await deps.search(token, query, RESULT_SIZE))
    return { list, found }
  })

  const products: Record<string, LiveProduct> = {}
  for (const { staple, lookup, key } of wanted) {
    const results = found.get(key)
    if (!results) continue
    const match = lookup.kind === 'pinned'
      ? results.find((p) => p.externalId === Number(staple.product_external_id))
      : results.find((p) => p.orderable)
    if (match) products[staple.id] = toLiveProduct(match)
  }

  const unique: RetailerProduct[] = []
  const seen = new Set<number>()
  for (const results of found.values()) {
    for (const p of results) {
      if (seen.has(p.externalId)) continue
      seen.add(p.externalId)
      unique.push(p)
    }
  }
  if (unique.length > 0) {
    const seenAt = deps.now()
    try {
      await deps.saveProducts(unique.map((p) => toProductRow(retailer, p, seenAt)))
    } catch (err) {
      deps.onCacheError?.(err)
    }
  }

  return { list, products, skippedLookups }
}
