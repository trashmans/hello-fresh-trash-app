// Fake retailer for preview and local (docs/adr/0004): same interface as the AH adapter,
// no network, an in-memory shopping list. Preview must never touch a real AH account.
//
// The products below are made up (names in AH's style, invented ids and prices), so this
// public repo holds no recorded personal data.

import { buildListPatchItems } from './ahSchema.ts'
import { RetailerError } from './types.ts'
import type { ListLine, RetailerAdapter, RetailerListItem, RetailerProduct } from './types.ts'

export const FAKE_PRODUCTS: RetailerProduct[] = [
  { externalId: 101, title: 'AH Halfvolle melk', salesUnitSize: '1 l', price: 1.19, orderable: true, promotion: null },
  { externalId: 102, title: 'AH Volle melk', salesUnitSize: '1 l', price: 1.29, orderable: true, promotion: null },
  { externalId: 103, title: 'AH Bananen tros', salesUnitSize: 'per tros', price: 1.69, orderable: true, promotion: null },
  { externalId: 104, title: 'AH Basmati rijst', salesUnitSize: '1 kg', price: 2.99, orderable: true, promotion: { mechanism: '2e GRATIS', priceBefore: 2.99 } },
  { externalId: 105, title: 'AH Scharreleieren L', salesUnitSize: '10 stuks', price: 3.49, orderable: true, promotion: null },
  { externalId: 106, title: 'AH Koriander', salesUnitSize: '20 g', price: 0.99, orderable: true, promotion: null },
  { externalId: 107, title: 'AH Pompoenpitten', salesUnitSize: '200 g', price: 2.49, orderable: true, promotion: { mechanism: '25% KORTING', priceBefore: 2.49 } },
  { externalId: 108, title: 'AH Lijnzaad gebroken', salesUnitSize: '250 g', price: 1.89, orderable: false, promotion: null },
]

const DAY_MS = 24 * 60 * 60 * 1000
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const normalise = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase()

export interface FakeAdapterOptions {
  products?: RetailerProduct[]
  list?: RetailerListItem[]
  now?: () => number
}

export function createFakeAdapter(opts: FakeAdapterOptions = {}): RetailerAdapter {
  const products = opts.products ?? FAKE_PRODUCTS
  const list: RetailerListItem[] = (opts.list ?? []).map((i) => ({ ...i }))
  const now = opts.now ?? (() => Date.now())
  let tokenCounter = 0

  return {
    kind: 'fake',
    retailer: 'ah',
    enabled: true,

    async exchangeLoginCode(code) {
      if (typeof code !== 'string' || !code) throw new RetailerError('invalid', 'No login code')
      tokenCounter++
      return { accessToken: `fake-access-${tokenCounter}`, refreshToken: `fake-refresh-${tokenCounter}`, expiresInSeconds: 7 * 24 * 3600 }
    },

    async getAccessToken() {
      tokenCounter++
      return { accessToken: `fake-access-${tokenCounter}`, refreshToken: `fake-refresh-${tokenCounter}`, expiresInSeconds: 7 * 24 * 3600 }
    },

    async searchProducts(_token, query, size = 10) {
      const words = normalise(query).split(' ').filter(Boolean)
      return products
        .filter((p) => words.every((w) => p.title.toLowerCase().includes(w)))
        .slice(0, size)
        .map((p) => ({ ...p }))
    },

    // The current Mon–Sun bonus week, like AH shows.
    async getPromotions() {
      const today = Date.parse(isoDate(now()))
      const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS
      return [{ start: isoDate(monday), end: isoDate(monday + 6 * DAY_MS) }]
    },

    async readList() {
      return list.map((i) => ({ ...i }))
    },

    // Same rules as AH: sending a line sets its quantity and unticks it.
    async writeListLines(_token, lines: ListLine[]) {
      buildListPatchItems(lines) // same validation as the real adapter (never removes)
      for (const line of lines) {
        const existing = list.find((i) =>
          line.productId != null ? i.productId === line.productId : i.productId == null && normalise(i.text) === normalise(line.text))
        if (existing) {
          existing.quantity = line.quantity
          existing.ticked = false
        } else {
          list.push({ productId: line.productId, text: line.text, quantity: line.quantity, ticked: false })
        }
      }
      return lines.map((line) => ({ line, ok: true }))
    },
  }
}
