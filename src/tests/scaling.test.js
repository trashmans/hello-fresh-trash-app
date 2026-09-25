import { describe, it, expect } from 'vitest'
import {
  computeScaleFactorFromServings,
  computeScaleFactorFromIngredient,
  scaleIngredients,
} from '@/lib/scaling'

describe('computeScaleFactorFromServings', () => {
  it('returns the ratio of target to base servings', () => {
    expect(computeScaleFactorFromServings(4, 2)).toBe(2)
    expect(computeScaleFactorFromServings(1, 2)).toBe(0.5)
  })

  it('returns null when base servings is missing or not positive', () => {
    expect(computeScaleFactorFromServings(4, null)).toBeNull()
    expect(computeScaleFactorFromServings(4, 0)).toBeNull()
    expect(computeScaleFactorFromServings(4, -2)).toBeNull()
  })

  it('returns null when target servings is missing or not positive', () => {
    expect(computeScaleFactorFromServings(null, 2)).toBeNull()
    expect(computeScaleFactorFromServings(0, 2)).toBeNull()
    expect(computeScaleFactorFromServings(-1, 2)).toBeNull()
  })
})

describe('computeScaleFactorFromIngredient', () => {
  it('compares raw quantities when units match exactly', () => {
    expect(computeScaleFactorFromIngredient({ quantity: 2, unit: 'clove' }, 6, 'clove')).toBe(3)
  })

  it('treats unit text as matching regardless of case and whitespace', () => {
    expect(computeScaleFactorFromIngredient({ quantity: 2, unit: ' Clove ' }, 4, 'clove')).toBe(2)
  })

  it('converts between compatible units of the same measurement type', () => {
    // 2 lb = 907.2 g, target 1 kg = 1000 g
    expect(computeScaleFactorFromIngredient({ quantity: 2, unit: 'lb' }, 1, 'kg')).toBeCloseTo(1000 / 907.2)
    // 1 cup = 240 mL, target 480 mL
    expect(computeScaleFactorFromIngredient({ quantity: 1, unit: 'cup' }, 480, 'ml')).toBe(2)
  })

  it('returns null when units are different measurement types', () => {
    expect(computeScaleFactorFromIngredient({ quantity: 1, unit: 'cup' }, 100, 'g')).toBeNull()
  })

  it('returns null when units differ and are not convertible', () => {
    expect(computeScaleFactorFromIngredient({ quantity: 2, unit: 'clove' }, 1, 'each')).toBeNull()
  })

  it('returns null when the ingredient quantity is missing or not positive', () => {
    expect(computeScaleFactorFromIngredient({ quantity: null, unit: 'g' }, 100, 'g')).toBeNull()
    expect(computeScaleFactorFromIngredient({ quantity: 0, unit: 'g' }, 100, 'g')).toBeNull()
    expect(computeScaleFactorFromIngredient(null, 100, 'g')).toBeNull()
  })

  it('returns null when the target quantity is missing or not positive', () => {
    expect(computeScaleFactorFromIngredient({ quantity: 100, unit: 'g' }, null, 'g')).toBeNull()
    expect(computeScaleFactorFromIngredient({ quantity: 100, unit: 'g' }, 0, 'g')).toBeNull()
  })
})

describe('scaleIngredients', () => {
  const ingredients = [
    { name: 'rice', quantity: 1.5, unit: 'cup' },
    { name: 'salt', quantity: null, unit: null },
  ]

  it('multiplies each quantity by the scale factor', () => {
    const scaled = scaleIngredients(ingredients, 2)
    expect(scaled[0]).toEqual({ name: 'rice', quantity: 3, unit: 'cup' })
  })

  it('passes through ingredients with no quantity unchanged', () => {
    expect(scaleIngredients(ingredients, 2)[1].quantity).toBeNull()
  })

  it('rounds scaled quantities for display', () => {
    // below 10 → one decimal place; 10 and above → whole number
    expect(scaleIngredients([{ quantity: 1, unit: 'cup' }], 1 / 3)[0].quantity).toBe(0.3)
    expect(scaleIngredients([{ quantity: 5, unit: 'g' }], 2.5)[0].quantity).toBe(13)
  })

  it('does not mutate the original ingredients', () => {
    scaleIngredients(ingredients, 2)
    expect(ingredients[0].quantity).toBe(1.5)
  })

  it('returns the original list when the factor is 1 or missing', () => {
    expect(scaleIngredients(ingredients, 1)).toBe(ingredients)
    expect(scaleIngredients(ingredients, null)).toBe(ingredients)
  })
})
