// Bonus stock-up: when a non-perishable staple is on bonus, buy enough to
// last max_weeks_stock weeks, rounded up to whole deal groups ("2e GRATIS"
// → pairs), and record how long that stock lasts in covered_until so the
// due rules in staples.js skip the staple until it runs out.
//
// Usage is measured in packs per week: usage_per_week if set, otherwise
// quantity ÷ cadence_weeks (one pack every two weeks = 0.5).
//
// Stock already at home counts toward the target. It is whichever lasts
// longer of: an earlier stock-up (covered_until), or the last normal
// purchase (cadence_weeks from the week it was added).
//
// Dates are 'YYYY-MM-DD' strings in the household's calendar, like staples.js.

import { weekStartOf } from './staples'

const DAY_MS = 24 * 60 * 60 * 1000
const EPSILON = 1e-9

/**
 * Reads an AH bonus label into { kind, groupSize }: how many packs make one
 * deal. Returns null when there is no bonus.
 */
export function parseBonusMechanism(label) {
  if (typeof label !== 'string' || !label.trim()) return null
  const text = label.trim().toUpperCase()

  let m
  if ((m = text.match(/(\d+)\s*%\s*KORTING/))) return { kind: 'percent', groupSize: 1 }
  if ((m = text.match(/^(\d+)\s*\+\s*(\d+)\s*GRATIS/))) return { kind: 'free', groupSize: Number(m[1]) + Number(m[2]) }
  if ((m = text.match(/(\d+)E\s+GRATIS/))) return { kind: 'free', groupSize: Number(m[1]) }
  if ((m = text.match(/(\d+)E\s+HALVE\s+PRIJS/))) return { kind: 'half_price', groupSize: Number(m[1]) }
  if ((m = text.match(/^(\d+)\s+VOOR\s/))) return { kind: 'multi_buy', groupSize: Number(m[1]) }
  if (/^VOOR\s/.test(text)) return { kind: 'price', groupSize: 1 }
  return { kind: 'other', groupSize: 1 }
}

// 'YYYY-MM-DD' → UTC ms, or null if not a real date (weekStartOf validates it).
function toMs(text) {
  if (weekStartOf(text) == null) return null
  const [y, m, d] = text.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

const toDate = (ms) => new Date(ms).toISOString().slice(0, 10)

function packsPerWeek(staple) {
  if (staple.usage_per_week > 0) return staple.usage_per_week
  const cadence = staple.cadence_weeks > 0 ? staple.cadence_weeks : 1
  return staple.quantity > 0 ? staple.quantity / cadence : null
}

/**
 * Plans a bonus stock-up for one staple in the week containing runDate.
 * Returns { packs, covered_until, reason } where reason is one of:
 *   'stock_up'        buy `packs`; save `covered_until` on the staple
 *   'stocked'         stock already reaches max_weeks_stock
 *   'no_bonus', 'perishable', 'not_configured', 'inactive', 'skipped'
 * Anything but 'stock_up' returns packs 0 and leaves covered_until as it was;
 * the normal due rules then decide.
 * Throws if runDate is not a valid 'YYYY-MM-DD' date.
 */
export function planStockUp(staple, { mechanism, runDate }) {
  const weekStart = weekStartOf(runDate)
  if (weekStart == null) throw new Error(`Invalid run date: ${runDate}`)

  const unchanged = (reason) => ({ packs: 0, covered_until: staple.covered_until ?? null, reason })

  if (staple.active === false) return unchanged('inactive')
  if (staple.skip_next) return unchanged('skipped')

  const deal = parseBonusMechanism(mechanism)
  if (!deal) return unchanged('no_bonus')
  if (staple.perishable) return unchanged('perishable')

  const usage = packsPerWeek(staple)
  if (!(staple.max_weeks_stock > 0) || !usage) return unchanged('not_configured')

  // Days of stock at home, counted from the Monday of the run week.
  const dayBeforeWeek = toMs(weekStart) - DAY_MS
  const coverEnds = []
  const covered = toMs(staple.covered_until)
  if (covered != null) coverEnds.push(covered)
  const lastAddedWeek = toMs(weekStartOf(staple.last_added_on))
  if (lastAddedWeek != null) {
    const cadence = staple.cadence_weeks > 0 ? staple.cadence_weeks : 1
    coverEnds.push(lastAddedWeek + cadence * 7 * DAY_MS - DAY_MS)
  }
  const stockEnd = coverEnds.length ? Math.max(...coverEnds) : dayBeforeWeek
  const stockDays = Math.max(0, Math.round((stockEnd - dayBeforeWeek) / DAY_MS))

  const neededDays = staple.max_weeks_stock * 7 - stockDays
  if (neededDays <= 0) return unchanged('stocked')

  const packsForTarget = Math.ceil((neededDays / 7) * usage - EPSILON)
  const packs = Math.ceil(packsForTarget / deal.groupSize) * deal.groupSize
  const boughtDays = Math.floor((packs / usage) * 7 + EPSILON)

  return {
    packs,
    covered_until: toDate(dayBeforeWeek + (stockDays + boughtDays) * DAY_MS),
    reason: 'stock_up',
  }
}
