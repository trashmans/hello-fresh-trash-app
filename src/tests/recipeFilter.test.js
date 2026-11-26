import { describe, it, expect } from 'vitest'
import { RECIPE_FILTERS, normalizeRecipeFilter, filterRecipes, groupFilterKey, groupIdOf } from '@/lib/recipeFilter'

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
  it('offers all, mine and friends, in that order, all available now that Social exists', () => {
    expect(RECIPE_FILTERS).toEqual([
      { key: 'all', label: 'All recipes' },
      { key: 'mine', label: 'My recipes' },
      { key: 'friends', label: "Friends' recipes" },
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

  it('friends: nothing while you have no friends', () => {
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

describe('group filters (Social groups, step G3)', () => {
  const FAMILY = '5d0c1b8e-3f2a-4c47-9a0e-1b2c3d4e5f60'
  const groups = [{ id: FAMILY, name: 'Family', members: [{ user_id: ME }, { user_id: OTHER }] }]

  it("names a group's filter 'group:<id>', and reads the id back", () => {
    expect(groupFilterKey(FAMILY)).toBe(`group:${FAMILY}`)
    expect(groupIdOf(`group:${FAMILY}`)).toBe(FAMILY)
    expect(groupIdOf('friends')).toBeNull()
    expect(groupIdOf(null)).toBeNull()
  })

  it('keeps a saved group filter, but not a malformed one', () => {
    expect(normalizeRecipeFilter(`group:${FAMILY}`)).toBe(`group:${FAMILY}`)
    for (const bad of ['group:', 'group:abc', `group:${FAMILY}x`, `GROUP:${FAMILY}`]) expect(normalizeRecipeFilter(bad)).toBe('all')
  })

  it('shows recipes uploaded by anyone in the group, me included', () => {
    expect(ids(filterRecipes(recipes, groupFilterKey(FAMILY), { userId: ME, groups }))).toEqual(['r1', 'r3', 'r4'])
  })

  it('shows everything while the group is not loaded or no longer exists', () => {
    expect(ids(filterRecipes(recipes, groupFilterKey(FAMILY), { userId: ME }))).toEqual(['r1', 'r2', 'r3', 'r4', 'r5'])
    expect(ids(filterRecipes(recipes, groupFilterKey('0f0f0f0f-0000-4000-8000-000000000000'), { userId: ME, groups })))
      .toEqual(['r1', 'r2', 'r3', 'r4', 'r5'])
  })
})
