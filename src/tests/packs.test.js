import { describe, it, expect } from 'vitest'
import { parsePackSize, ingredientToBase, packsNeeded } from '@/lib/packs'

// AH writes pack sizes as Dutch display strings (salesUnitSize in the API),
// e.g. "1,5 l", "400 g", "6 stuks". These tests use real examples from the spike.
describe('parsePackSize', () => {
  it('parses litres and millilitres, with a Dutch decimal comma', () => {
    expect(parsePackSize('1 l')).toEqual({ value: 1000, type: 'volume' })
    expect(parsePackSize('1,5 l')).toEqual({ value: 1500, type: 'volume' })
    expect(parsePackSize('0,5 l')).toEqual({ value: 500, type: 'volume' })
    expect(parsePackSize('70 ml')).toEqual({ value: 70, type: 'volume' })
  })

  it('parses grams and kilograms', () => {
    expect(parsePackSize('400 g')).toEqual({ value: 400, type: 'mass' })
    expect(parsePackSize('1 kg')).toEqual({ value: 1000, type: 'mass' })
  })

  it('parses piece counts', () => {
    expect(parsePackSize('6 stuks')).toEqual({ value: 6, type: 'count' })
    expect(parsePackSize('1 stuk')).toEqual({ value: 1, type: 'count' })
    expect(parsePackSize('per stuk')).toEqual({ value: 1, type: 'count' })
    expect(parsePackSize('per bos')).toEqual({ value: 1, type: 'count' })
  })

  it('multiplies multipacks', () => {
    expect(parsePackSize('2 x 125 g')).toEqual({ value: 250, type: 'mass' })
    expect(parsePackSize('4 x 1,5 l')).toEqual({ value: 6000, type: 'volume' })
  })

  it('ignores an approximate prefix', () => {
    expect(parsePackSize('ca. 500 g')).toEqual({ value: 500, type: 'mass' })
  })

  it('is case- and whitespace-insensitive', () => {
    expect(parsePackSize('  400 G ')).toEqual({ value: 400, type: 'mass' })
  })

  it('returns null for loose-weight items and text it cannot read', () => {
    expect(parsePackSize('per kilo')).toBeNull()
    expect(parsePackSize('per kg')).toBeNull()
    expect(parsePackSize('a bag of stuff')).toBeNull()
    expect(parsePackSize('')).toBeNull()
    expect(parsePackSize(null)).toBeNull()
  })
})

// Recipe ingredients arrive in whatever units parse-recipe extracted (often US).
// The planner works in metric base units: g, mL, or a piece count.
describe('ingredientToBase', () => {
  it('converts US mass and volume to metric base units', () => {
    expect(ingredientToBase(12, 'oz')).toEqual({ value: 12 * 28.35, type: 'mass' })
    expect(ingredientToBase(2, 'cup')).toEqual({ value: 480, type: 'volume' })
  })

  it('passes metric units through', () => {
    expect(ingredientToBase(250, 'g')).toEqual({ value: 250, type: 'mass' })
    expect(ingredientToBase(1, 'l')).toEqual({ value: 1000, type: 'volume' })
  })

  it('treats a missing unit or a piece word as a count', () => {
    expect(ingredientToBase(3, null)).toEqual({ value: 3, type: 'count' })
    expect(ingredientToBase(3, '')).toEqual({ value: 3, type: 'count' })
    expect(ingredientToBase(2, 'pieces')).toEqual({ value: 2, type: 'count' })
    expect(ingredientToBase(1, 'whole')).toEqual({ value: 1, type: 'count' })
  })

  it('returns null for units that cannot be matched to a pack size', () => {
    expect(ingredientToBase(2, 'clove')).toBeNull()
    expect(ingredientToBase(1, 'pinch')).toBeNull()
  })

  it('returns null when the quantity is missing or not positive', () => {
    expect(ingredientToBase(null, 'g')).toBeNull()
    expect(ingredientToBase(0, 'g')).toBeNull()
    expect(ingredientToBase(-1, 'g')).toBeNull()
  })
})

describe('packsNeeded', () => {
  const g = (value) => ({ value, type: 'mass' })

  it('rounds up to whole packs', () => {
    expect(packsNeeded(g(340), g(300))).toBe(2)
    expect(packsNeeded(g(600), g(300))).toBe(2)
    expect(packsNeeded(g(601 * 1.06), g(300))).toBe(3)
  })

  it('needs at least one pack for any positive amount', () => {
    expect(packsNeeded(g(10), g(300))).toBe(1)
    expect(packsNeeded({ value: 3, type: 'count' }, { value: 6, type: 'count' })).toBe(1)
  })

  it('accepts being up to 5% short of a pack instead of buying another', () => {
    expect(packsNeeded(g(300), g(300))).toBe(1)
    expect(packsNeeded(g(315), g(300))).toBe(1)   // 5% over one pack: still 1
    expect(packsNeeded(g(316), g(300))).toBe(2)   // just over 5%: 2
  })

  it('lets the caller change the tolerance', () => {
    expect(packsNeeded(g(310), g(300), { tolerance: 0 })).toBe(2)
  })

  it('returns 0 when nothing is needed', () => {
    expect(packsNeeded(g(0), g(300))).toBe(0)
  })

  it('returns null when the types do not match or a size is unusable', () => {
    expect(packsNeeded(g(300), { value: 500, type: 'volume' })).toBeNull()
    expect(packsNeeded(g(300), { value: 0, type: 'mass' })).toBeNull()
    expect(packsNeeded(g(300), null)).toBeNull()
    expect(packsNeeded(null, g(300))).toBeNull()
  })
})
