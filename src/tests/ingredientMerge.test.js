import { describe, it, expect } from 'vitest'
import { mergeIngredients } from '@/lib/ingredientMerge'

// Each recipe serves 2 and is selected at 2 servings unless a test says otherwise.
function merge(recipes) {
  const selections = recipes.map(r => ({ recipe_id: r.id, servings: r.selected ?? 2 }))
  const ingredientsMap = Object.fromEntries(recipes.map(r => [r.id, r.ingredients]))
  const recipesMap = Object.fromEntries(recipes.map(r => [r.id, { id: r.id, name: r.name ?? r.id, servings: r.servings ?? 2 }]))
  return mergeIngredients(selections, ingredientsMap, recipesMap)
}

const ing = (name, quantity, unit = null) => ({ name, quantity, unit, preparation: null })

describe('mergeIngredients: real duplicates from the shopping list', () => {
  it('merges olive oil given as TBSP, tsp and T into one tablespoon line', () => {
    const items = merge([
      { id: 'a', name: 'Recipe A', ingredients: [ing('Olive Oil', 1, 'TBSP')] },
      { id: 'b', name: 'Recipe B', ingredients: [ing('Olive oil', 6, 'tsp')] },
      { id: 'c', name: 'Recipe C', ingredients: [ing('Olive Oil', 3, 'T')] },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: 'Olive Oil', unit: 'tbsp', computedQty: 6 })
    // Each recipe's share is shown in the merged line's unit
    expect(items[0].contributions.map(c => [c.recipeName, c.scaledQty])).toEqual([
      ['Recipe A', 1], ['Recipe B', 2], ['Recipe C', 3],
    ])
  })

  it('merges singular and plural names', () => {
    const items = merge([
      { id: 'a', ingredients: [ing('Sweet Potato', 1)] },
      { id: 'b', ingredients: [ing('Sweet Potatoes', 2)] },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: 'Sweet Potato', unit: null, computedQty: 3 })
  })

  it('merges "veggie" and "vegetable"', () => {
    const items = merge([
      { id: 'a', ingredients: [ing('Vegetable Stock Concentrate', 1)] },
      { id: 'b', ingredients: [ing('Veggie Stock Concentrate', 0.5)] },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: 'Vegetable Stock Concentrate', computedQty: 1.5 })
  })
})

describe('mergeIngredients: other variations that should merge', () => {
  it('merges singular and plural count units', () => {
    const items = merge([
      { id: 'a', ingredients: [ing('Garlic', 2, 'clove')] },
      { id: 'b', ingredients: [ing('Garlic', 1, 'cloves')] },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ unit: 'clove', computedQty: 3 })
  })

  it('treats "unit", "piece", "whole" and a blank unit as the same count', () => {
    const items = merge([
      { id: 'a', ingredients: [ing('Lime', 1, 'unit')] },
      { id: 'b', ingredients: [ing('Lime', 1, null)] },
      { id: 'c', ingredients: [ing('Lime', 1, 'whole')] },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ unit: null, computedQty: 3 })
  })

  it('ignores case and stray spaces in names', () => {
    const items = merge([
      { id: 'a', ingredients: [ing('Ginger ', 1, 'tbsp')] },
      { id: 'b', ingredients: [ing(' fresh  ginger', 1, 'tbsp')] },
      { id: 'c', ingredients: [ing('GINGER', 1, 'tbsp')] },
    ])
    expect(items.map(i => i.name)).toEqual(['fresh ginger', 'Ginger'])
    expect(items.find(i => i.name === 'Ginger').computedQty).toBe(2)
  })

  it('treats plural endings on the last word only', () => {
    const items = merge([
      { id: 'a', ingredients: [ing('Green Beans', 200, 'g'), ing('Cherry Tomatoes', 4), ing('Mixed Berries', 100, 'g')] },
      { id: 'b', ingredients: [ing('Green Bean', 100, 'g'), ing('Cherry Tomato', 2), ing('Mixed Berry', 50, 'g')] },
    ])
    expect(items).toHaveLength(3)
  })

  it('adds metric units of the same kind', () => {
    const items = merge([
      { id: 'a', ingredients: [ing('Butter', 100, 'g')] },
      { id: 'b', ingredients: [ing('Butter', 0.2, 'kg')] },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ unit: 'g', computedQty: 300 })
  })
})

describe('mergeIngredients: things that must stay separate', () => {
  it('keeps volume and weight of the same ingredient apart', () => {
    const items = merge([
      { id: 'a', ingredients: [ing('Flour', 1, 'cup')] },
      { id: 'b', ingredients: [ing('Flour', 100, 'g')] },
    ])
    expect(items).toHaveLength(2)
  })

  it('keeps different cuts and varieties apart', () => {
    const items = merge([
      { id: 'a', ingredients: [ing('Chicken Breast', 300, 'g')] },
      { id: 'b', ingredients: [ing('Chicken Thighs', 300, 'g')] },
    ])
    expect(items).toHaveLength(2)
  })

  it('keeps a measured amount and a count apart', () => {
    const items = merge([
      { id: 'a', ingredients: [ing('Garlic', 2, 'clove')] },
      { id: 'b', ingredients: [ing('Garlic', 1, 'tsp')] },
    ])
    expect(items).toHaveLength(2)
  })
})

describe('mergeIngredients: existing behaviour kept', () => {
  it('scales by selected servings, in the merged unit', () => {
    const items = merge([
      { id: 'a', selected: 4, ingredients: [ing('Olive Oil', 1, 'tbsp')] },   // ×2 → 2 tbsp
      { id: 'b', ingredients: [ing('Olive Oil', 3, 'tsp')] },                 // ×1 → 1 tbsp
    ])
    expect(items[0]).toMatchObject({ unit: 'tbsp', computedQty: 3 })
    expect(items[0].contributions[0]).toMatchObject({ scaledQty: 2, baseQty: 1, scaleFactor: 2 })
    expect(items[0].contributions[1]).toMatchObject({ scaledQty: 1, baseQty: 1, scaleFactor: 1 })
  })

  it('shows no total when any recipe gives no quantity', () => {
    const items = merge([
      { id: 'a', ingredients: [ing('Salt', 1, 'tsp')] },
      { id: 'b', ingredients: [ing('Salt', null, 'tsp')] },
    ])
    expect(items[0].computedQty).toBeNull()
  })

  it('sorts lines alphabetically by name', () => {
    const items = merge([{ id: 'a', ingredients: [ing('Zucchini', 1), ing('apple', 1), ing('Basil', 1)] }])
    expect(items.map(i => i.name)).toEqual(['apple', 'Basil', 'Zucchini'])
  })

  it('gives variants of the same line the same key', () => {
    const one = merge([{ id: 'a', ingredients: [ing('Sweet Potatoes', 1)] }])[0].key
    const two = merge([{ id: 'a', ingredients: [ing('sweet potato', 1, 'unit')] }])[0].key
    expect(one).toBe(two)
  })
})
