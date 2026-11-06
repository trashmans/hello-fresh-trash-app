// Retailer-neutral types for the adapter interface (docs/adr/0004-retailer-adapter.md).
// Everything outside an adapter works with these, never with a retailer's own JSON.

export type RetailerErrorCode =
  | 'disabled'    // kill switch off (RETAILER_AH_ENABLED) — nothing was sent
  | 'auth'        // the retailer refused the token: the household must re-link
  | 'http'        // other HTTP failure (after retries for 429 / 5xx)
  | 'timeout'     // no answer within the timeout (after retries)
  | 'schema'      // the response no longer has the shape we expect — stop, don't guess
  | 'invalid'     // we were asked to send something unsafe (e.g. quantity 0 = remove)
  | 'unsupported' // no adapter for this retailer
  | 'not_linked'  // the household has not linked this retailer
  | 'forbidden'   // not allowed: no household, or the household's AH switch (ah_enabled) is off

export class RetailerError extends Error {
  code: RetailerErrorCode
  status: number | null

  constructor(code: RetailerErrorCode, message: string, status: number | null = null) {
    super(message)
    this.name = 'RetailerError'
    this.code = code
    this.status = status
  }
}

export interface RetailerProduct {
  externalId: number
  title: string
  salesUnitSize: string | null
  price: number | null
  orderable: boolean
  /** National bonus only; personal offers are never passed on (ADR 0004). */
  promotion: { mechanism: string; priceBefore: number | null } | null
}

export interface RetailerPromotionPeriod {
  start: string // 'YYYY-MM-DD'
  end: string
}

export interface RetailerListItem {
  productId: number | null // null for free-text lines
  text: string
  quantity: number
  ticked: boolean
}

/** One line to set on the list: always unticked, quantity ≥ 1 (we never remove). */
export interface ListLine {
  productId: number | null
  text: string
  quantity: number
}

export interface TokenRefresh {
  accessToken: string
  refreshToken: string | null // null if the retailer didn't rotate it
  expiresInSeconds: number | null
}

export interface WriteResult {
  line: ListLine
  ok: boolean
  error?: RetailerError
}

export interface RetailerAdapter {
  kind: 'ah' | 'fake'
  retailer: string
  enabled: boolean
  /** Linking: trades the one-time login code for tokens. */
  exchangeLoginCode(code: string): Promise<TokenRefresh>
  getAccessToken(refreshToken: string): Promise<TokenRefresh>
  searchProducts(accessToken: string, query: string, size?: number): Promise<RetailerProduct[]>
  getPromotions(accessToken: string): Promise<RetailerPromotionPeriod[]>
  readList(accessToken: string): Promise<RetailerListItem[]>
  writeListLines(accessToken: string, lines: ListLine[]): Promise<WriteResult[]>
}
