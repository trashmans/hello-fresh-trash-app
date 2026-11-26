import { describe, it, expect } from 'vitest'
import { EQUIPMENT, detectEquipment, equipmentInUse, filterByEquipment } from '@/lib/equipment'

// Equipment tags, read from a recipe's name and steps (no stored column).
const recipe = (steps, name = 'Dinner', over = {}) => ({ id: name, name, steps, ...over })

describe('EQUIPMENT', () => {
  it('lists the nine tags in a fixed order', () => {
    expect(EQUIPMENT).toEqual([
      'Air fryer', 'Instant Pot', 'Slow cooker', 'Blender', 'Food processor',
      'Stand mixer', 'Wok', 'Dutch oven', 'Cast-iron pan',
    ])
  })
})

describe('detectEquipment', () => {
  it('finds equipment named in the steps', () => {
    expect(detectEquipment(recipe(['Preheat the air fryer to 200°C.', 'Air fry the wings for 20 minutes.']))).toEqual(['Air fryer'])
    expect(detectEquipment(recipe(['Heat oil in a wok over high heat.']))).toEqual(['Wok'])
    expect(detectEquipment(recipe(['Pulse the herbs in a food processor.']))).toEqual(['Food processor'])
    expect(detectEquipment(recipe(['Beat the butter in a stand mixer.']))).toEqual(['Stand mixer'])
    expect(detectEquipment(recipe(['Brown the beef in a Dutch oven.']))).toEqual(['Dutch oven'])
  })

  it('also reads the recipe name', () => {
    expect(detectEquipment(recipe(['Cook as directed.'], 'Instant Pot Coconut Chicken Curry'))).toEqual(['Instant Pot'])
  })

  it('knows other names for the same thing', () => {
    expect(detectEquipment(recipe(['Pressure cook on high for 8 minutes.']))).toEqual(['Instant Pot'])
    expect(detectEquipment(recipe(['Seal the pressure cooker.']))).toEqual(['Instant Pot'])
    expect(detectEquipment(recipe(['Cook in the Crock-Pot on low.']))).toEqual(['Slow cooker'])
    expect(detectEquipment(recipe(['Cook in the slow-cooker for 6 hours.']))).toEqual(['Slow cooker'])
    expect(detectEquipment(recipe(['Put them in the airfryer basket.']))).toEqual(['Air fryer'])
    expect(detectEquipment(recipe(['Blitz with an immersion blender.']))).toEqual(['Blender'])
    expect(detectEquipment(recipe(['Use a stick blender until smooth.']))).toEqual(['Blender'])
    expect(detectEquipment(recipe(['Sear in a cast iron skillet.']))).toEqual(['Cast-iron pan'])
    expect(detectEquipment(recipe(['Sear in a cast-iron pan.']))).toEqual(['Cast-iron pan'])
  })

  it('matches whole words only', () => {
    expect(detectEquipment(recipe(['Blend the spices with the oil.', 'Woke up early; bake in the oven.']))).toEqual([])
    expect(detectEquipment(recipe(['Preheat the oven to 220°C.']))).toEqual([]) // a plain oven is not a tag
  })

  it('is case-insensitive', () => {
    expect(detectEquipment(recipe(['ADD TO THE INSTANT POT.']))).toEqual(['Instant Pot'])
  })

  it('gives each tag once, in the fixed order', () => {
    const r = recipe(['Fry garlic in the wok.', 'Blend in a blender.', 'Back to the wok.', 'Finish in the air fryer.'])
    expect(detectEquipment(r)).toEqual(['Air fryer', 'Blender', 'Wok'])
  })

  it('gives [] when there is nothing to read', () => {
    expect(detectEquipment(recipe([]))).toEqual([])
    expect(detectEquipment({ name: null, steps: null })).toEqual([])
    expect(detectEquipment(null)).toEqual([])
  })
})

describe('equipmentInUse', () => {
  it('lists the tags the recipes use, in the fixed order', () => {
    const recipes = [recipe(['Use the wok.'], 'A'), recipe(['Air fry it.'], 'B'), recipe(['Just stir.'], 'C')]
    expect(equipmentInUse(recipes)).toEqual(['Air fryer', 'Wok'])
  })

  it('gives [] for no recipes', () => {
    expect(equipmentInUse([])).toEqual([])
    expect(equipmentInUse(null)).toEqual([])
  })
})

describe('filterByEquipment', () => {
  const recipes = [
    recipe(['Air fry the wings.', 'Toss in a wok.'], 'Wings'),
    recipe(['Air fry the tofu.'], 'Tofu'),
    recipe(['Stir in a wok.'], 'Stir fry'),
  ]

  it('keeps recipes that use every chosen tag', () => {
    expect(filterByEquipment(recipes, ['Air fryer']).map(r => r.name)).toEqual(['Wings', 'Tofu'])
    expect(filterByEquipment(recipes, ['Air fryer', 'Wok']).map(r => r.name)).toEqual(['Wings'])
  })

  it('gives the same list back when nothing is chosen', () => {
    expect(filterByEquipment(recipes, [])).toBe(recipes)
    expect(filterByEquipment(recipes, null)).toBe(recipes)
  })
})
