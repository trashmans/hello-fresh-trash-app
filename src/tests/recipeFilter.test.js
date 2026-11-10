import { describe, it, expect } from 'vitest'
import { RECIPE_FILTERS, normalizeRecipeFilter, filterRecipes } from '@/lib/recipeFilter'

const ME = 'user-me'
const FRIEND = 'user-friend'
const OTHER = 'user-other'
const recipes = [
  { id: 'r1', uploaded_by: ME },
  { id: 'r2', uploaded_by: FRIEND },
  { id: 'r3', uploaded_by: OTHER },
  { id: 'r4', uploaded_by: ME },
  { id: 'r5', uploaded_by: null },
]
const ids = (list) => list.map((r) => r.id)

describe('RECIPE_FILTERS', () => {
  it('offers all, mine and friends, in that order; friends needs the Social tab', () => {
    expect(RECIPE_FILTERS).toEqual([
      { key: 'all', label: 'All recipes' },
      { key: 'mine', label: 'My recipes' },
      { key: 'friends', label: "Friends' recipes", needsSocial: true },
    ])
  })
})

describe('normalizeRecipeFilter', () => {
  it('keeps known filter keys', () => {
    for (const key of ['all', 'mine', 'friends']) expect(normalizeRecipeFilter(key)).toBe(key)
  })

  it('falls back to all for anything else (nothing saved, old or tampered values)', () => {
    for (const value of [null, undefined, '', 'MINE', 'household', 1, {}]) expect(normalizeRecipeFilter(value)).toBe('all')
  })
})

describe('filterRecipes', () => {
  it('all: returns every recipe, in the same order', () => {
    expect(ids(filterRecipes(recipes, 'all', { userId: ME }))).toEqual(['r1', 'r2', 'r3', 'r4', 'r5'])
  })

  it('mine: only recipes I uploaded', () => {
    expect(ids(filterRecipes(recipes, 'mine', { userId: ME }))).toEqual(['r1', 'r4'])
  })

  it('mine: nothing when the user id is unknown', () => {
    expect(filterRecipes(recipes, 'mine', { userId: null })).toEqual([])
  })

  it('friends: only recipes uploaded by a friend', () => {
    expect(ids(filterRecipes(recipes, 'friends', { userId: ME, friendIds: [FRIEND] }))).toEqual(['r2'])
  })

  it('friends: nothing until there are friends (before the Social tab exists)', () => {
    expect(filterRecipes(recipes, 'friends', { userId: ME })).toEqual([])
    expect(filterRecipes(recipes, 'friends', { userId: ME, friendIds: [] })).toEqual([])
  })

  it('treats an unknown filter as all', () => {
    expect(ids(filterRecipes(recipes, 'household', { userId: ME }))).toEqual(['r1', 'r2', 'r3', 'r4', 'r5'])
  })

  it('does not change the list it was given', () => {
    const copy = recipes.map((r) => ({ ...r }))
    filterRecipes(recipes, 'mine', { userId: ME })
    expect(recipes).toEqual(copy)
  })
})
