import { describe, it, expect } from 'vitest'
import { RECIPE_TABLE_COLUMNS, compareRecipesByColumn, sortRecipes } from '@/lib/recipeSort'

const col = (key) => RECIPE_TABLE_COLUMNS.find(c => c.key === key)

describe('compareRecipesByColumn', () => {
  it('sorts numbers ascending', () => {
    expect(compareRecipesByColumn({ calories_kcal: 100 }, { calories_kcal: 200 }, col('calories_kcal'))).toBeLessThan(0)
    expect(compareRecipesByColumn({ calories_kcal: 200 }, { calories_kcal: 100 }, col('calories_kcal'))).toBeGreaterThan(0)
    expect(compareRecipesByColumn({ calories_kcal: 100 }, { calories_kcal: 100 }, col('calories_kcal'))).toBe(0)
  })

  it('sorts strings case-insensitively via localeCompare', () => {
    expect(compareRecipesByColumn({ cuisine: 'italian' }, { cuisine: 'Mexican' }, col('cuisine'))).toBeLessThan(0)
  })

  it('always sorts nulls last, regardless of which side is null', () => {
    expect(compareRecipesByColumn({ fibre_g: null }, { fibre_g: 5 }, col('fibre_g'))).toBe(1)
    expect(compareRecipesByColumn({ fibre_g: 5 }, { fibre_g: null }, col('fibre_g'))).toBe(-1)
    expect(compareRecipesByColumn({ fibre_g: null }, { fibre_g: null }, col('fibre_g'))).toBe(0)
  })

  it('treats 0 as a real value, not missing', () => {
    expect(compareRecipesByColumn({ fat_g: 0 }, { fat_g: null }, col('fat_g'))).toBe(-1)
    expect(compareRecipesByColumn({ fat_g: 0 }, { fat_g: 5 }, col('fat_g'))).toBeLessThan(0)
  })
})

describe('sortRecipes', () => {
  const recipes = [
    { id: 'a', name: 'Tacos', calories_kcal: 650, protein_g: 30 },
    { id: 'b', name: 'Salad', calories_kcal: 200, protein_g: null },
    { id: 'c', name: 'Curry', calories_kcal: 420, protein_g: 18 },
  ]

  it('sorts ascending by a numeric column, nulls last', () => {
    expect(sortRecipes(recipes, 'calories_kcal', 'asc').map(r => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('sorts descending by a numeric column, nulls still last', () => {
    expect(sortRecipes(recipes, 'protein_g', 'desc').map(r => r.id)).toEqual(['a', 'c', 'b'])
  })

  it('defaults to ascending when no direction is given', () => {
    expect(sortRecipes(recipes, 'calories_kcal').map(r => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('returns the same array reference for an unknown column key', () => {
    expect(sortRecipes(recipes, null)).toBe(recipes)
    expect(sortRecipes(recipes, 'not_a_column')).toBe(recipes)
  })

  it('does not mutate the input array', () => {
    const copy = [...recipes]
    sortRecipes(recipes, 'calories_kcal', 'asc')
    expect(recipes).toEqual(copy)
  })
})
