// Checks Albert Heijn responses and turns them into our own types (docs/adr/0004).
// Field names come from the spike (spike/ah-api/FINDINGS.md). If AH changes a response
// so the list we rely on is missing, this throws a 'schema' error and the run stops,
// instead of passing on wrong data. Individual malformed entries are skipped.
//
// Pure: no network.

import { RetailerError } from './types.ts'
import type { ListLine, RetailerListItem, RetailerProduct, RetailerPromotionPeriod, TokenRefresh } from './types.ts'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
const schema = (what: string) => new RetailerError('schema', `Unexpected AH response: ${what}`)

function listOf(data: unknown, key: string): unknown[] {
  if (!isObject(data) || !Array.isArray(data[key])) throw schema(`no "${key}" list`)
  return data[key]
}

/** /mobile-services/product/search/v2 → products. */
export function parseSearchResponse(data: unknown): RetailerProduct[] {
  const products: RetailerProduct[] = []
  for (const p of listOf(data, 'products')) {
    if (!isObject(p)) continue
    const externalId = Number(p.webshopId)
    const title = text(p.title)
    if (!Number.isInteger(externalId) || externalId <= 0 || !title) continue
    const mechanism = p.isBonus === true ? text(p.bonusMechanism) : null
    products.push({
      externalId,
      title,
      salesUnitSize: text(p.salesUnitSize),
      price: num(p.currentPrice) ?? num(p.priceBeforeBonus),
      orderable: p.isOrderable !== false && p.availableOnline !== false,
      promotion: mechanism ? { mechanism, priceBefore: num(p.priceBeforeBonus) } : null,
    })
  }
  return products
}

/** /mobile-auth/v1/auth/token/refresh → tokens. AH rotates the refresh token on every refresh. */
export function parseTokenResponse(data: unknown): TokenRefresh {
  if (!isObject(data)) throw schema('token response is not an object')
  const accessToken = text(data.access_token)
  if (!accessToken) throw schema('no access_token')
  return {
    accessToken,
    refreshToken: text(data.refresh_token),
    expiresInSeconds: num(data.expires_in),
  }
}

/** /mobile-services/bonuspage/v3/metadata → bonus weeks (Mon–Sun). */
export function parseBonusPeriods(data: unknown): RetailerPromotionPeriod[] {
  return listOf(data, 'periods').flatMap((p) => {
    if (!isObject(p) || typeof p.bonusStartDate !== 'string' || typeof p.bonusEndDate !== 'string') return []
    const start = p.bonusStartDate.slice(0, 10)
    const end = p.bonusEndDate.slice(0, 10)
    return DATE.test(start) && DATE.test(end) ? [{ start, end }] : []
  })
}

/** /mobile-services/shoppinglist/v2/items (GET) → list items. Free-text lines have no product id. */
export function parseListResponse(data: unknown): RetailerListItem[] {
  return listOf(data, 'items').flatMap((i) => {
    if (!isObject(i)) return []
    const id = Number(i.productDetails?.product?.webshopId ?? i.productId)
    return [{
      productId: Number.isInteger(id) && id > 0 ? id : null,
      text: typeof i.description === 'string' ? i.description : '',
      quantity: num(i.quantity) ?? 0,
      ticked: Boolean(i.strikedthrough),
    }]
  })
}

/**
 * Lines → items for PATCH /mobile-services/shoppinglist/v2/items. Sending a line sets its
 * quantity and unticks it (FINDINGS.md part 2). Quantity 0 would remove an item, so anything
 * below 1 is refused here: the weekly shop only ever adds or raises.
 */
export function buildListPatchItems(lines: ListLine[]) {
  return lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new RetailerError('invalid', `Refusing quantity ${line.quantity}: the weekly shop never removes or lowers items`)
    }
    const description = text(line.text)
    if (!description) throw new RetailerError('invalid', 'A list line needs a description')
    if (line.productId == null) {
      return { description, quantity: line.quantity, type: 'SHOPPABLE', originCode: 'TXT', strikeThrough: false }
    }
    if (!Number.isInteger(line.productId) || line.productId <= 0) {
      throw new RetailerError('invalid', `Invalid product id ${line.productId}`)
    }
    return {
      description, productId: line.productId, quantity: line.quantity,
      type: 'SHOPPABLE', originCode: 'PRD', searchTerm: description, strikeThrough: false,
    }
  })
}
