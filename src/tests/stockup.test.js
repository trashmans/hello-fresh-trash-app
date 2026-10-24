import { describe, it, expect } from 'vitest'
import { parseBonusMechanism, planStockUp } from '@/lib/stockup'

// AH bonus labels, as returned in the API's bonusMechanism / discountDescription fields.
describe('parseBonusMechanism', () => {
  it('reads percentage discounts as single-pack deals', () => {
    expect(parseBonusMechanism('10% KORTING')).toEqual({ kind: 'percent', groupSize: 1 })
    expect(parseBonusMechanism('25% korting')).toEqual({ kind: 'percent', groupSize: 1 })
  })

  it('reads "second free" deals as pairs', () => {
    expect(parseBonusMechanism('2e GRATIS')).toEqual({ kind: 'free', groupSize: 2 })
    expect(parseBonusMechanism('1+1 GRATIS')).toEqual({ kind: 'free', groupSize: 2 })
  })

  it('reads "N+1 free" deals as groups of N+1', () => {
    expect(parseBonusMechanism('2+1 GRATIS')).toEqual({ kind: 'free', groupSize: 3 })
  })

  it('reads "second half price" as pairs', () => {
    expect(parseBonusMechanism('2e HALVE PRIJS')).toEqual({ kind: 'half_price', groupSize: 2 })
  })

  it('reads multi-buy prices as groups', () => {
    expect(parseBonusMechanism('3 VOOR 5,00')).toEqual({ kind: 'multi_buy', groupSize: 3 })
    expect(parseBonusMechanism('2 voor 4.50')).toEqual({ kind: 'multi_buy', groupSize: 2 })
  })

  it('reads a plain bonus price as a single-pack deal', () => {
    expect(parseBonusMechanism('VOOR 1,99')).toEqual({ kind: 'price', groupSize: 1 })
  })

  it('treats an unrecognised label as a single-pack deal', () => {
    expect(parseBonusMechanism('OP=OP')).toEqual({ kind: 'other', groupSize: 1 })
  })

  it('returns null when there is no bonus', () => {
    expect(parseBonusMechanism(null)).toBeNull()
    expect(parseBonusMechanism('')).toBeNull()
    expect(parseBonusMechanism('   ')).toBeNull()
  })
})

// 2026-10-26 is a Monday. Coffee: 1 pack every 2 weeks = 0.5 packs/week, up to 8 weeks of stock.
const RUN = '2026-10-26'
const coffee = (overrides = {}) => ({
  id: 'coffee',
  quantity: 1,
  cadence_weeks: 2,
  usage_per_week: 0.5,
  perishable: false,
  max_weeks_stock: 8,
  active: true,
  skip_next: false,
  last_added_on: null,
  covered_until: null,
  ...overrides,
})

describe('planStockUp', () => {
  it('buys enough for the maximum weeks of stock, rounded up to the deal', () => {
    // 8 weeks × 0.5 = 4 packs; 4 is already a multiple of 2. Covers 8 weeks: through Sunday 2026-12-20.
    expect(planStockUp(coffee(), { mechanism: '2e GRATIS', runDate: RUN }))
      .toEqual({ packs: 4, covered_until: '2026-12-20', reason: 'stock_up' })
  })

  it('rounds up to a whole deal group', () => {
    // 8 weeks × 0.5 = 4 packs → next multiple of 3 is 6 → covers 12 weeks: through 2027-01-17.
    expect(planStockUp(coffee(), { mechanism: '2+1 GRATIS', runDate: RUN }))
      .toEqual({ packs: 6, covered_until: '2027-01-17', reason: 'stock_up' })
  })

  it('needs no rounding for a percentage discount', () => {
    expect(planStockUp(coffee({ max_weeks_stock: 6 }), { mechanism: '10% KORTING', runDate: RUN }))
      .toEqual({ packs: 3, covered_until: '2026-12-06', reason: 'stock_up' })
  })

  it('counts stock already at home from an earlier stock-up', () => {
    // Covered through 2026-11-08 (2 weeks). Needs 6 more weeks = 3 packs → pair deal → 4 packs (8 weeks).
    // New cover: 2 + 8 = 10 weeks from the run week, through 2027-01-03.
    expect(planStockUp(coffee({ covered_until: '2026-11-08' }), { mechanism: '2e GRATIS', runDate: RUN }))
      .toEqual({ packs: 4, covered_until: '2027-01-03', reason: 'stock_up' })
  })

  it('counts stock from the last normal purchase', () => {
    // Bought in the week of 2026-10-19, cadence 2 weeks → lasts through Sunday 2026-11-01 (1 week into this run).
    // Needs 7 more weeks × 0.5 = 3.5 → 4 packs (pair deal) = 8 weeks → through 2026-12-27.
    expect(planStockUp(coffee({ last_added_on: '2026-10-21' }), { mechanism: '2e GRATIS', runDate: RUN }))
      .toEqual({ packs: 4, covered_until: '2026-12-27', reason: 'stock_up' })
  })

  it('does nothing when stock already reaches the maximum', () => {
    expect(planStockUp(coffee({ covered_until: '2027-02-28' }), { mechanism: '2e GRATIS', runDate: RUN }))
      .toEqual({ packs: 0, covered_until: '2027-02-28', reason: 'stocked' })
  })

  it('works out usage from quantity and cadence when usage_per_week is empty', () => {
    // 1 pack / 2 weeks = 0.5/week, same as the explicit value
    expect(planStockUp(coffee({ usage_per_week: null }), { mechanism: '2e GRATIS', runDate: RUN }).packs).toBe(4)
  })

  it('accepts any date in the run week', () => {
    expect(planStockUp(coffee(), { mechanism: '2e GRATIS', runDate: '2026-10-29' }).covered_until).toBe('2026-12-20')
  })

  it('leaves perishables to the normal due rules', () => {
    expect(planStockUp(coffee({ perishable: true }), { mechanism: '2e GRATIS', runDate: RUN }))
      .toEqual({ packs: 0, covered_until: null, reason: 'perishable' })
  })

  it('does nothing without a bonus', () => {
    expect(planStockUp(coffee(), { mechanism: null, runDate: RUN }))
      .toEqual({ packs: 0, covered_until: null, reason: 'no_bonus' })
  })

  it('does nothing when the maximum weeks of stock is not set', () => {
    expect(planStockUp(coffee({ max_weeks_stock: null }), { mechanism: '2e GRATIS', runDate: RUN }).reason)
      .toBe('not_configured')
    expect(planStockUp(coffee({ max_weeks_stock: 0 }), { mechanism: '2e GRATIS', runDate: RUN }).reason)
      .toBe('not_configured')
  })

  it('does nothing when usage cannot be worked out', () => {
    expect(planStockUp(coffee({ usage_per_week: null, quantity: 0 }), { mechanism: '2e GRATIS', runDate: RUN }).reason)
      .toBe('not_configured')
  })

  it('respects inactive and skip-next staples', () => {
    expect(planStockUp(coffee({ active: false }), { mechanism: '2e GRATIS', runDate: RUN }).reason).toBe('inactive')
    expect(planStockUp(coffee({ skip_next: true }), { mechanism: '2e GRATIS', runDate: RUN }).reason).toBe('skipped')
  })

  it('throws on an invalid run date', () => {
    expect(() => planStockUp(coffee(), { mechanism: '2e GRATIS', runDate: 'soon' })).toThrow()
  })
})
