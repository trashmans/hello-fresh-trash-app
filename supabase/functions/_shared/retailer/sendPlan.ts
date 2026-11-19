// Send to AH (rollout phase 6, docs/adr/0005): the server's own checks before anything is
// written to a household's real AH list. Pure: no network, no database.
//
//   checkSendRequest()        the browser's request: which lines to send for which week, and
//                             which staple dates to save afterwards. Anything unexpected is
//                             refused before a token is touched.
//   planWrites()              compares those lines with the AH list as it is now and keeps only
//                             writes that add something: a new item, a higher quantity, or
//                             unticking. Never removes, never lowers, never touches items that
//                             are only on the AH list. Sending again after it worked writes nothing.
//   applicableStapleUpdates() which staple dates to save after the writes: only for staples
//                             whose line is on the AH list afterwards, so a failed line leaves
//                             the staple due for the next send.

import type { ListLine, RetailerListItem } from './types.ts'

export const MAX_SEND_LINES = 60
export const MAX_LINE_QUANTITY = 20
export const MAX_TEXT_LENGTH = 120
const MAX_STAPLE_UPDATES = 100
const SOURCES = new Set(['staple', 'stockup', 'recipe'])
const STAPLE_FIELDS = new Set(['staple_id', 'product_id', 'last_added_on', 'covered_until', 'skip_next'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export type Source = 'staple' | 'stockup' | 'recipe'

export interface SendLine {
  productId: number | null
  text: string
  quantity: number
  sources: Source[]
}

export interface StapleUpdate {
  staple_id: string
  product_id: number | null
  last_added_on?: string
  covered_until?: string | null
  skip_next?: false
}

export interface SendRequest {
  weekStart: string
  lines: SendLine[]
  stapleUpdates: StapleUpdate[]
}

export type SendCheck = { ok: true; request: SendRequest } | { ok: false; message: string }

export interface Write extends ListLine {
  action: 'add' | 'increase' | 'untick'
  from: number
  sources: Source[]
}

export interface Skipped {
  productId: number | null
  text: string
  quantity: number
  reason: 'already_enough'
}

/** 'written', 'already_enough' or 'failed' per line, keyed by lineKey(). */
export type LineOutcome = 'written' | 'already_enough' | 'failed'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const clean = (v: string) => v.trim().replace(/\s+/g, ' ')

/** How the AH list identifies an item: product id, or free text ignoring case and spacing. */
export function lineKey(productId: number | null, text: string | null | undefined): string {
  return productId != null ? `p:${productId}` : `t:${clean(text ?? '').toLowerCase()}`
}

function isRealDate(text: unknown): text is string {
  if (typeof text !== 'string') return false
  const m = text.match(DATE)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

const isMonday = (text: string) => new Date(`${text}T00:00:00Z`).getUTCDay() === 1

function readProductId(v: unknown): number | null | undefined {
  if (v == null) return null
  if (typeof v === 'string' && /^\d+$/.test(v)) v = Number(v)
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined // undefined = invalid
}

const refuse = (message: string): SendCheck => ({ ok: false, message })

export function checkSendRequest(raw: unknown): SendCheck {
  if (!isObject(raw)) return refuse('Nothing to send.')

  const weekStart = raw.weekStart
  if (!isRealDate(weekStart) || !isMonday(weekStart)) return refuse('The preview is for an unknown week. Refresh it and try again.')

  if (!Array.isArray(raw.lines) || raw.lines.length === 0) return refuse('Nothing to send.')
  if (raw.lines.length > MAX_SEND_LINES) return refuse(`Send at most ${MAX_SEND_LINES} items at a time.`)

  const lines: SendLine[] = []
  const keys = new Set<string>()
  for (const entry of raw.lines) {
    if (!isObject(entry)) return refuse('An item in the preview could not be read. Refresh it and try again.')
    const productId = readProductId(entry.productId)
    if (productId === undefined) return refuse('An item has an unknown AH product. Refresh the preview and try again.')
    const text = typeof entry.text === 'string' ? clean(entry.text) : ''
    if (!text) return refuse('An item has no description. Refresh the preview and try again.')
    if (text.length > MAX_TEXT_LENGTH) return refuse(`An item's description is longer than ${MAX_TEXT_LENGTH} characters.`)
    const quantity = entry.quantity
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
      return refuse(`"${text}": the quantity must be a whole number from 1 to ${MAX_LINE_QUANTITY}.`)
    }
    const sources = entry.sources
    if (!Array.isArray(sources) || sources.length === 0 || !sources.every((s) => typeof s === 'string' && SOURCES.has(s))) {
      return refuse(`"${text}": unknown reason for adding it. Refresh the preview and try again.`)
    }
    const key = lineKey(productId, text)
    if (keys.has(key)) return refuse(`"${text}" is in the send twice. Refresh the preview and try again.`)
    keys.add(key)
    lines.push({ productId, text, quantity, sources: [...sources] as Source[] })
  }

  const rawUpdates = raw.stapleUpdates ?? []
  if (!Array.isArray(rawUpdates) || rawUpdates.length > MAX_STAPLE_UPDATES) return refuse('The staple updates could not be read.')
  const productIds = new Set(lines.filter((l) => l.productId != null).map((l) => l.productId as number))
  const stapleUpdates: StapleUpdate[] = []
  const stapleIds = new Set<string>()
  for (const u of rawUpdates) {
    const bad = refuse('A staple update could not be read. Refresh the preview and try again.')
    if (!isObject(u) || !Object.keys(u).every((k) => STAPLE_FIELDS.has(k))) return bad
    if (typeof u.staple_id !== 'string' || !UUID.test(u.staple_id) || stapleIds.has(u.staple_id)) return bad
    const productId = readProductId(u.product_id)
    if (productId === undefined) return bad
    const has = (k: string) => Object.prototype.hasOwnProperty.call(u, k)
    if (!has('last_added_on') && !has('covered_until') && !has('skip_next')) return bad
    if (has('last_added_on') && u.last_added_on !== weekStart) return bad
    if (has('covered_until') && u.covered_until !== null && !isRealDate(u.covered_until)) return bad
    if (has('skip_next') && u.skip_next !== false) return bad
    if ((has('last_added_on') || has('covered_until')) && (productId == null || !productIds.has(productId))) return bad

    const update: StapleUpdate = { staple_id: u.staple_id, product_id: productId }
    if (has('last_added_on')) update.last_added_on = u.last_added_on as string
    if (has('covered_until')) update.covered_until = u.covered_until as string | null
    if (has('skip_next')) update.skip_next = false
    stapleIds.add(u.staple_id)
    stapleUpdates.push(update)
  }

  return { ok: true, request: { weekStart, lines, stapleUpdates } }
}

export function planWrites(lines: SendLine[], current: RetailerListItem[]): { writes: Write[]; skipped: Skipped[] } {
  const onList = new Map<string, RetailerListItem>()
  for (const item of current) onList.set(lineKey(item.productId, item.text), item)

  const writes: Write[] = []
  const skipped: Skipped[] = []
  for (const line of lines) {
    const existing = onList.get(lineKey(line.productId, line.text))
    const write = (action: Write['action'], from: number) =>
      writes.push({ action, productId: line.productId, text: line.text, from, quantity: line.quantity, sources: line.sources })

    if (!existing) write('add', 0)
    else if (existing.ticked) write('untick', 0)
    else if ((existing.quantity ?? 0) < line.quantity) write('increase', existing.quantity ?? 0)
    else skipped.push({ productId: line.productId, text: line.text, quantity: existing.quantity, reason: 'already_enough' })
  }
  return { writes, skipped }
}

export function applicableStapleUpdates(updates: StapleUpdate[], outcomes: Map<string, LineOutcome>): StapleUpdate[] {
  const onListNow = (o: LineOutcome | undefined) => o === 'written' || o === 'already_enough'
  if (![...outcomes.values()].some(onListNow)) return [] // nothing reached AH: the week isn't sent
  return updates.filter((u) => u.product_id == null || onListNow(outcomes.get(lineKey(u.product_id, null))))
}
