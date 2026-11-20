import { describe, it, expect } from 'vitest'
import { recipeCardMeta, catalogueHeading, weekListNote } from '@/lib/recipeCard'

describe('recipeCardMeta', () => {
  it('shows total time, servings and calories', () => {
    const recipe = { cook_time_minutes: 20, prep_time_minutes: 10, servings: 2, calories_kcal: 780 }
    expect(recipeCardMeta(recipe)).toEqual(['30 min', 'Serves 2', '780 kcal'])
  })

  it('uses whichever time is known when only one is', () => {
    expect(recipeCardMeta({ cook_time_minutes: 25 })).toEqual(['25 min'])
    expect(recipeCardMeta({ prep_time_minutes: 5 })).toEqual(['5 min'])
  })

  it('marks estimated calories with ~', () => {
    const recipe = { calories_kcal: 690, nutrition_estimated: ['calories_kcal'] }
    expect(recipeCardMeta(recipe)).toEqual(['~690 kcal'])
  })

  it('leaves out anything missing', () => {
    expect(recipeCardMeta({})).toEqual([])
    expect(recipeCardMeta({ servings: null, calories_kcal: null })).toEqual([])
  })
})

describe('catalogueHeading', () => {
  it('counts recipes, singular and plural', () => {
    expect(catalogueHeading(12, [])).toBe('12 recipes')
    expect(catalogueHeading(1, [])).toBe('1 recipe')
    expect(catalogueHeading(0)).toBe('0 recipes')
  })

  it('names the ingredients being searched for', () => {
    expect(catalogueHeading(7, ['garlic'])).toBe('7 recipes with garlic')
    expect(catalogueHeading(3, ['garlic', 'onion'])).toBe('3 recipes with garlic and onion')
    expect(catalogueHeading(1, ['garlic', 'onion', 'rice'])).toBe('1 recipe with garlic, onion and rice')
  })
})

describe('weekListNote', () => {
  it("says how many shown recipes are in this week's list", () => {
    expect(weekListNote(3)).toBe("3 in this week's list")
    expect(weekListNote(1)).toBe("1 in this week's list")
  })

  it('says nothing when none are', () => {
    expect(weekListNote(0)).toBeNull()
  })
})
