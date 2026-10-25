import { describe, it, expect } from 'vitest'
import { normalizeUnit, toBaseUnit, convertIngredientUnit } from '@/lib/units'

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
