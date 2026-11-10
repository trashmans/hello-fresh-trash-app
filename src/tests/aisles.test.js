import { describe, it, expect } from 'vitest'
import { AISLES, aisleFor, groupByAisle } from '@/lib/aisles'

describe('AISLES', () => {
  it('lists the aisles in shop-walking order, with Other last', () => {
    expect(AISLES).toEqual(['Produce', 'Meat & fish', 'Dairy & eggs', 'Bakery', 'Pantry', 'Herbs & spices', 'Other'])
  })
})

describe('aisleFor', () => {
  const cases = {
    Produce: [
      'spinach', 'zucchini', 'button mushrooms', 'grape tomatoes', 'red onion', 'yellow onion', 'lemon', 'carrot',
      'celery', 'parsley', 'cilantro', 'green herb blend', 'corn on the cob', 'garlic', 'ginger', 'scallions',
      'bell pepper', 'green beans', 'eggplant', 'sweet potatoes', 'avocado', 'kale',
    ],
    'Meat & fish': ['chicken thighs', 'chicken breast', 'ground beef', 'steak', 'pork sausage', 'shrimp', 'salmon fillets', 'bacon'],
    'Dairy & eggs': ['feta cheese', 'parmesan cheese', 'grilling cheese', 'sour cream', 'butter', 'milk', 'eggs', 'egg', 'ricotta', 'greek yogurt', 'cream cheese'],
    Bakery: ['demi-baguette', 'flour tortillas', 'naan', 'pita', 'ciabatta roll', 'brioche buns'],
    Pantry: [
      'arborio rice', 'cannellini beans', 'kidney beans', 'chickpeas', 'crushed tomatoes', 'tomato paste',
      'mushroom stock concentrate', 'veggie stock concentrate', 'chicken stock concentrate', 'pho stock concentrate',
      'miso sauce concentrate', 'hoisin sauce', 'soy sauce', 'chili crisp', 'basil oil', 'olive oil', 'coconut milk',
      'israeli couscous', 'pearl couscous', 'ramen noodles', 'egg noodles', 'pistachios', 'peanut butter',
      'panko breadcrumbs', 'honey', 'red wine vinegar', 'butter beans',
    ],
    'Herbs & spices': ['garlic powder', 'chili flakes', 'red pepper flakes', 'italian seasoning', 'smoked paprika', 'ground cumin', 'dried oregano', 'salt', 'black pepper'],
  }

  for (const [aisle, names] of Object.entries(cases)) {
    it(`puts ${names.length} ingredients in ${aisle}`, () => {
      for (const name of names) expect([name, aisleFor(name)]).toEqual([name, aisle])
    })
  }

  it('ignores case, extra spaces and preparation words', () => {
    expect(aisleFor('  Cannellini Beans, rinsed and drained ')).toBe('Pantry')
    expect(aisleFor('ONION, peeled and diced')).toBe('Produce')
  })

  it('puts unknown or empty names in Other', () => {
    for (const name of ['wonton wrappers', '', null, undefined]) expect(aisleFor(name)).toBe('Other')
  })
})

describe('groupByAisle', () => {
  const items = [
    { name: 'spinach' },
    { name: 'garlic powder' },
    { name: 'feta cheese' },
    { name: 'mystery item' },
    { name: 'zucchini' },
  ]

  it('returns only the aisles that have items, in AISLES order, keeping item order within each', () => {
    expect(groupByAisle(items)).toEqual([
      { aisle: 'Produce', items: [{ name: 'spinach' }, { name: 'zucchini' }] },
      { aisle: 'Dairy & eggs', items: [{ name: 'feta cheese' }] },
      { aisle: 'Herbs & spices', items: [{ name: 'garlic powder' }] },
      { aisle: 'Other', items: [{ name: 'mystery item' }] },
    ])
  })

  it('returns an empty list for no items', () => {
    expect(groupByAisle([])).toEqual([])
  })
})
