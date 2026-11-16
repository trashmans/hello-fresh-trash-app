import { describe, it, expect } from 'vitest'
import {
  computeScaleFactorFromServings,
  computeScaleFactorFromIngredient,
  scaleIngredients,
  scaleStepText,
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

// Amounts written inside the instructions. Recipe cards give home-supplied
// ingredients (water, butter, oil) only there, so they must scale with the
// servings and follow the viewer's units like the ingredient list does.
describe('scaleStepText', () => {
  const US = { volume_unit: 'us', mass_unit: 'us' }
  const METRIC = { volume_unit: 'metric', mass_unit: 'metric' }
  const water = 'Wash and dry all produce. Combine 4 cups of water and the stock concentrates in a medium pot.'
  const butter = 'Melt 1 tablespoon of butter in a large pan over medium-high heat'

  it('scales the water in the reported step when the servings double', () => {
    expect(scaleStepText(water, 2, US)).toBe('Wash and dry all produce. Combine 8 cups of water and the stock concentrates in a medium pot.')
  })

  it('scales the butter in the reported step, and makes the unit plural', () => {
    expect(scaleStepText(butter, 2, US)).toBe('Melt 2 tablespoons of butter in a large pan over medium-high heat')
  })

  it('scales down, and makes the unit singular again', () => {
    expect(scaleStepText(water, 0.25, US)).toBe('Wash and dry all produce. Combine 1 cup of water and the stock concentrates in a medium pot.')
    expect(scaleStepText('Add 2 tablespoons of oil.', 0.5, US)).toBe('Add 1 tablespoon of oil.')
  })

  it('leaves the text exactly as written when nothing needs to change', () => {
    for (const text of [water, butter, 'Drizzle with 1 TBSP olive oil and ¼ tsp salt.']) {
      expect(scaleStepText(text, 1, US)).toBe(text)
      expect(scaleStepText(text, null, US)).toBe(text)
      expect(scaleStepText(text, undefined, undefined)).toBe(text)
    }
  })

  it("shows step amounts in the viewer's units, like the ingredient list", () => {
    expect(scaleStepText(water, 1, METRIC)).toBe('Wash and dry all produce. Combine 960 mL of water and the stock concentrates in a medium pot.')
    expect(scaleStepText(butter, 1, METRIC)).toBe('Melt 15 mL of butter in a large pan over medium-high heat')
    expect(scaleStepText('Add 500 g of pasta.', 1, US)).toBe('Add 1.1 lb of pasta.')
  })

  it('scales first and then picks the unit', () => {
    expect(scaleStepText(water, 2, METRIC)).toBe('Wash and dry all produce. Combine 1.9 L of water and the stock concentrates in a medium pot.')
  })

  it('reads fractions however they are written', () => {
    expect(scaleStepText('Add ¼ cup water.', 2, US)).toBe('Add 0.5 cup water.')
    expect(scaleStepText('Add 1½ cups water.', 2, US)).toBe('Add 3 cups water.')
    expect(scaleStepText('Add 1 1/2 cups water.', 2, US)).toBe('Add 3 cups water.')
    expect(scaleStepText('Add 1/2 teaspoon sugar.', 4, US)).toBe('Add 2 teaspoons sugar.')
    expect(scaleStepText('Add 1.5 cups water.', 2, US)).toBe('Add 3 cups water.')
  })

  it('keeps abbreviations as the card wrote them', () => {
    expect(scaleStepText('Heat 1 TBSP oil; add 2 tsp sugar and 10 oz chicken.', 2, US)).toBe('Heat 2 TBSP oil; add 4 tsp sugar and 20 oz chicken.')
    expect(scaleStepText('Cook 250g rice.', 2, METRIC)).toBe('Cook 500g rice.')
  })

  it('scales both ends of a range', () => {
    expect(scaleStepText('Add 2–3 tablespoons of water.', 2, US)).toBe('Add 4–6 tablespoons of water.')
    expect(scaleStepText('Add 1-2 TBSP water.', 3, US)).toBe('Add 3-6 TBSP water.')
    expect(scaleStepText('Add 1 to 2 cups of stock.', 2, US)).toBe('Add 2 to 4 cups of stock.')
  })

  it('scales every amount in a step', () => {
    expect(scaleStepText('Whisk 2 cups of water with 1 tablespoon of butter and 1 teaspoon of salt.', 2, US))
      .toBe('Whisk 4 cups of water with 2 tablespoons of butter and 2 teaspoons of salt.')
  })

  it('leaves times, temperatures, sizes and counts alone', () => {
    const text = 'Cook 4–5 minutes at {{temp:425F}} degrees. Dice into ½-inch pieces, add 2 cloves of garlic and 3 large eggs, then rest 10 minutes in 2 pans.'
    expect(scaleStepText(text, 2, METRIC)).toBe(text)
  })

  it('does not read a unit inside a longer word or a hyphenated size', () => {
    for (const text of ['Juice 1 lime.', 'Use a 1-cup measure.', 'Add 2 glasses of wine.', 'Slice 1 leek.']) {
      expect(scaleStepText(text, 2, US)).toBe(text)
    }
  })

  it('rounds like the ingredient list', () => {
    expect(scaleStepText('Add 1 tablespoon of oil.', 1.5, US)).toBe('Add 1.5 tablespoons of oil.')
    expect(scaleStepText('Add 3 cups of water.', 3.5, US)).toBe('Add 11 cups of water.')
  })

  it('passes missing text through', () => {
    expect(scaleStepText('', 2, US)).toBe('')
    expect(scaleStepText(null, 2, US)).toBeNull()
    expect(scaleStepText(undefined, 2, US)).toBeUndefined()
  })
})
