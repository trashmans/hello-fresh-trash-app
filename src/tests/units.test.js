import { describe, it, expect } from 'vitest'
import { normalizeUnit, toBaseUnit, convertIngredientUnit, bestUnitInSystem, unitOptionsFor, unitOptionValueFor } from '@/lib/units'

describe('normalizeUnit', () => {
  it('reads US recipe shorthand by case: capital T is a tablespoon, lowercase t a teaspoon', () => {
    expect(normalizeUnit('T')).toEqual({ unit: 'tbsp', type: 'volume', toBase: 15 })
    expect(normalizeUnit('t')).toEqual({ unit: 'tsp', type: 'volume', toBase: 5 })
  })

  it('reads other spellings case-insensitively', () => {
    expect(normalizeUnit('TBSP')).toEqual({ unit: 'tbsp', type: 'volume', toBase: 15 })
    expect(normalizeUnit('Tablespoons')).toEqual({ unit: 'tbsp', type: 'volume', toBase: 15 })
    expect(normalizeUnit(' tsp. ')).toEqual({ unit: 'tsp', type: 'volume', toBase: 5 })
    expect(normalizeUnit('Grams')).toEqual({ unit: 'g', type: 'mass', toBase: 1 })
  })

  it('returns null for units that are not measurements', () => {
    expect(normalizeUnit('cloves')).toBeNull()
    expect(normalizeUnit('unit')).toBeNull()
    expect(normalizeUnit('')).toBeNull()
    expect(normalizeUnit(null)).toBeNull()
  })
})

describe('T and t in existing conversions', () => {
  it('converts T and t to base units', () => {
    expect(toBaseUnit(3, 'T')).toEqual({ value: 45, type: 'volume' })
    expect(toBaseUnit(2, 't')).toEqual({ value: 10, type: 'volume' })
  })

  it('shows T in mL for metric viewers', () => {
    expect(convertIngredientUnit(3, 'T', { volume_unit: 'metric' })).toEqual({ quantity: 45, unit: 'mL' })
  })
})

describe('bestUnitInSystem', () => {
  it('picks the largest unit that gives at least 1, like the recipe view', () => {
    expect(bestUnitInSystem(90, 'volume', 'metric')).toEqual({ unit: 'ml', label: 'mL', toBase: 1 })
    expect(bestUnitInSystem(1500, 'volume', 'metric')).toEqual({ unit: 'l', label: 'L', toBase: 1000 })
    expect(bestUnitInSystem(300, 'mass', 'us')).toEqual({ unit: 'oz', label: 'oz', toBase: 28.35 })
    expect(bestUnitInSystem(900, 'mass', 'us')).toEqual({ unit: 'lb', label: 'lb', toBase: 453.6 })
  })

  it('falls back to the smallest unit for tiny amounts', () => {
    expect(bestUnitInSystem(0.5, 'mass', 'metric')).toEqual({ unit: 'g', label: 'g', toBase: 1 })
  })

  it('returns null for an unknown type or system', () => {
    expect(bestUnitInSystem(100, 'count', 'metric')).toBeNull()
    expect(bestUnitInSystem(100, 'mass', 'imperial')).toBeNull()
  })
})

// The "scale by ingredient" unit dropdown offers the standard spellings (tsp, tbsp,
// cup…), but recipes store units as written on the card ("Cup", "cups", "TBSP").
// Selecting an ingredient must preselect the option for its own unit; otherwise the
// dropdown shows its first option (tsp) while the amount is still read in the
// recipe's unit, so 0.75 cups of rice looked like "0.75 tsp".
describe('unitOptionValueFor', () => {
  it("gives the dropdown's spelling for a unit as the recipe wrote it", () => {
    expect(unitOptionValueFor('Cup')).toBe('cup')
    expect(unitOptionValueFor('cups')).toBe('cup')
    expect(unitOptionValueFor('TBSP')).toBe('tbsp')
    expect(unitOptionValueFor('Tablespoons')).toBe('tbsp')
    expect(unitOptionValueFor('T')).toBe('tbsp')
    expect(unitOptionValueFor('t')).toBe('tsp')
    expect(unitOptionValueFor('oz.')).toBe('oz')
    expect(unitOptionValueFor('Grams')).toBe('g')
    expect(unitOptionValueFor('mL')).toBe('ml')
  })

  it('is always one of the options the dropdown offers for that unit', () => {
    for (const raw of ['Cup', 'cups', 'TBSP', 'tsp', 'T', 't', 'fl oz', 'oz', 'LB', 'lbs', 'g', 'Kg', 'ml', 'L', 'Liters']) {
      const values = unitOptionsFor(raw).map(o => o.value)
      expect(values, raw).toContain(unitOptionValueFor(raw))
    }
  })

  it('keeps the rice example in cups, not the first option in the list', () => {
    const options = unitOptionsFor('Cup')
    expect(options[0].value).toBe('tsp') // why the dropdown used to show tsp
    expect(unitOptionValueFor('Cup')).toBe('cup')
  })

  it('leaves a unit that is not a measurement as written', () => {
    expect(unitOptionValueFor('clove')).toBe('clove')
    expect(unitOptionValueFor('Stock Cube')).toBe('Stock Cube')
    expect(unitOptionsFor('clove').map(o => o.value)).toContain(unitOptionValueFor('clove'))
  })

  it('is empty for a missing unit, like the single option offered for it', () => {
    expect(unitOptionValueFor(null)).toBe('')
    expect(unitOptionValueFor(undefined)).toBe('')
    expect(unitOptionValueFor('')).toBe('')
    expect(unitOptionsFor(null).map(o => o.value)).toContain(unitOptionValueFor(null))
  })
})
