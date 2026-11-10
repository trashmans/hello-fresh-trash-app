import { describe, it, expect } from 'vitest'
import { STAPLE_LIMITS, toStapleRow, describeStaple } from '@/lib/stapleForm'

const pinned = { name: 'Sweet onions', productExternalId: 525871, searchTerm: '', quantity: 1, cadenceWeeks: 1, stockUp: false, maxWeeksStock: '' }

describe('STAPLE_LIMITS', () => {
  it('matches the database checks on household_staples', () => {
    expect(STAPLE_LIMITS).toEqual({ nameMax: 80, searchMin: 2, searchMax: 60, quantity: [1, 20], cadenceWeeks: [1, 12], maxWeeksStock: [1, 26] })
  })
})

describe('toStapleRow', () => {
  it('turns a pinned-product form into a database row', () => {
    expect(toStapleRow(pinned)).toEqual({
      ok: true,
      row: { name: 'Sweet onions', product_external_id: 525871, search_term: null, quantity: 1, cadence_weeks: 1, perishable: true, max_weeks_stock: null },
    })
  })

  it('accepts a search term instead of a product, tidying spaces', () => {
    const result = toStapleRow({ ...pinned, productExternalId: null, searchTerm: '  gebroken   lijnzaad ' })
    expect(result.ok).toBe(true)
    expect(result.row).toMatchObject({ product_external_id: null, search_term: 'gebroken lijnzaad' })
  })

  it('keeps both a pinned product and a search term when given', () => {
    expect(toStapleRow({ ...pinned, searchTerm: 'AH Zoete uien' }).row).toMatchObject({ product_external_id: 525871, search_term: 'AH Zoete uien' })
  })

  it('reads numbers typed as text and trims the name', () => {
    const result = toStapleRow({ ...pinned, name: '  Onions ', quantity: '2', cadenceWeeks: '3' })
    expect(result.row).toMatchObject({ name: 'Onions', quantity: 2, cadence_weeks: 3 })
  })

  it('stock up on bonus makes the staple non-perishable with a weeks limit', () => {
    expect(toStapleRow({ ...pinned, stockUp: true, maxWeeksStock: '6' }).row).toMatchObject({ perishable: false, max_weeks_stock: 6 })
  })

  it('without stock up, any weeks limit is dropped', () => {
    expect(toStapleRow({ ...pinned, stockUp: false, maxWeeksStock: 6 }).row).toMatchObject({ perishable: true, max_weeks_stock: null })
  })

  it('explains every problem at once, per field', () => {
    const result = toStapleRow({ name: ' ', productExternalId: null, searchTerm: 'a', quantity: 0, cadenceWeeks: 13, stockUp: true, maxWeeksStock: '' })
    expect(result.ok).toBe(false)
    expect(Object.keys(result.errors).sort()).toEqual(['cadenceWeeks', 'maxWeeksStock', 'name', 'quantity', 'searchTerm'])
    for (const message of Object.values(result.errors)) expect(message).toMatch(/\S/)
  })

  it('needs a product or a search term', () => {
    const result = toStapleRow({ ...pinned, productExternalId: null, searchTerm: '' })
    expect(result.ok).toBe(false)
    expect(result.errors.searchTerm).toMatch(/\S/)
  })

  it('refuses fractions and out-of-range values', () => {
    for (const quantity of [1.5, 21, -1, 'two', null]) expect(toStapleRow({ ...pinned, quantity }).errors?.quantity).toBeTruthy()
    for (const cadenceWeeks of [0, 2.5, 13]) expect(toStapleRow({ ...pinned, cadenceWeeks }).errors?.cadenceWeeks).toBeTruthy()
    for (const maxWeeksStock of [0, 27, 1.5]) expect(toStapleRow({ ...pinned, stockUp: true, maxWeeksStock }).errors?.maxWeeksStock).toBeTruthy()
  })

  it('refuses names over 80 characters', () => {
    expect(toStapleRow({ ...pinned, name: 'x'.repeat(81) }).errors?.name).toBeTruthy()
  })
})

describe('describeStaple', () => {
  const row = { quantity: 1, cadence_weeks: 1, perishable: true, max_weeks_stock: null, skip_next: false, active: true }

  it('says how many and how often', () => {
    expect(describeStaple(row)).toBe('1 every week')
    expect(describeStaple({ ...row, quantity: 2, cadence_weeks: 3 })).toBe('2 every 3 weeks')
  })

  it('mentions stocking up on bonus', () => {
    expect(describeStaple({ ...row, perishable: false, max_weeks_stock: 6 })).toBe('1 every week · stocks up on bonus (up to 6 weeks)')
  })

  it('leads with paused or skipping, paused winning', () => {
    expect(describeStaple({ ...row, skip_next: true })).toBe('Skipping next order · 1 every week')
    expect(describeStaple({ ...row, active: false, skip_next: true })).toBe('Paused · 1 every week')
  })
})
