// Sorts shopping-list ingredients into supermarket aisles for the Shopping
// tab. Keyword rules, checked in order; the first match wins. The order
// matters: specific phrases come before the general words they contain, so
// "garlic powder" is a spice (not garlic), "mushroom stock concentrate" is
// pantry (not mushrooms), "basil oil" is pantry (not basil), "green beans"
// are produce (not tinned beans) and "egg noodles" are pantry (not eggs).
// Anything unmatched goes to Other. Pure: no I/O.

export const AISLES = ['Produce', 'Meat & fish', 'Dairy & eggs', 'Bakery', 'Pantry', 'Herbs & spices', 'Other']

const RULES = [
  // Kit concentrates and stocks, whatever they're made from; snack chips.
  ['Pantry', /\b(stock|broth|bouillon|concentrates?|tortilla chips|pita chips)\b/],
  // Dry spices and seasonings, before the fresh produce words they contain.
  ['Herbs & spices', /\b(powder|flakes|seasoning|spice blend|paprika|cumin|turmeric|cinnamon|nutmeg|cardamom|cayenne|oregano|za'?atar|sumac|bay lea(f|ves)|peppercorns?|black pepper|salt|dried (oregano|thyme|basil|rosemary|parsley|dill|herbs?|chil(i|e|ies|es))|ground (coriander|ginger|cloves?|allspice))\b/],
  // Fresh items whose names contain a pantry word.
  ['Produce', /\b(green beans?|snap peas?|sugar snap peas?|bean sprouts|edamame)\b/],
  // Bakery before pantry, so "flour tortillas" isn't flour.
  ['Bakery', /\b(bread|baguettes?|buns?|rolls?|tortillas?|pitas?|naan|flatbreads?|ciabatta|brioche|bagels?|wraps?|croissants?|sourdough)\b/],
  ['Pantry', /\b(beans?|chickpeas?|lentils?|coconut (milk|cream)|crushed tomato(es)?|diced tomato(es)?|tomato (paste|sauce|puree)|canned|tinned|sauce|paste|oils?|vinegar|honey|sugar|syrup|flour|cornstarch|rice|pasta|noodles?|couscous|quinoa|oats|panko|breadcrumbs?|crisp|pesto|mustard|mayo(nnaise)?|ketchup|sriracha|jam|peanuts?|almonds?|walnuts?|pistachios?|cashews?|pine nuts?|pecans?|sesame seeds?|seeds|raisins?|wine|gemelli|penne|spaghetti|orzo|farro|bulgur|crackers|croutons)\b/],
  ['Meat & fish', /\b(chicken|beef|pork|turkey|lamb|steaks?|sausages?|bacon|ham|chorizo|prosciutto|salami|pancetta|mince|veal|duck|salmon|cod|tilapia|haddock|tuna|shrimp|prawns?|scallops?|mussels?|fish|crab)\b/],
  ['Dairy & eggs', /\b(milk|cream|cheese|cheddar|mozzarella|parmesan|parmigiano|feta|ricotta|halloumi|mascarpone|paneer|burrata|gouda|brie|butter|yog(h)?urt|eggs?|cr[eè]me fra[iî]che)\b/],
  ['Produce', /\b(onions?|shallots?|scallions?|leeks?|garlic|ginger|lemons?|limes?|oranges?|apples?|pears?|bananas?|berries|grapes?|tomato(es)?|potato(es)?|carrots?|celery|zucchinis?|courgettes?|squash|pumpkin|cucumbers?|lettuce|romaine|spinach|kale|arugula|rocket|cabbage|slaw|broccoli(ni)?|cauliflower|mushrooms?|peppers?|chil(i|e|ies|es)|jalape(n|ñ)os?|poblanos?|corn|avocados?|parsley|cilantro|coriander|basil|mint|dill|thyme|rosemary|chives|sage|herbs?|asparagus|peas|eggplants?|aubergines?|radish(es)?|beets?|beetroot|fennel|mango(es)?|pineapple|bok choy|watercress|sprouts|salad|greens|leaves)\b/],
]

// Lower case, only the part before the first comma ("onion, peeled and
// diced" → "onion"), single spaces.
function normalize(name) {
  if (typeof name !== 'string') return ''
  return name.split(',')[0].toLowerCase().replace(/\s+/g, ' ').trim()
}

export function aisleFor(name) {
  const text = normalize(name)
  if (!text) return 'Other'
  for (const [aisle, pattern] of RULES) {
    if (pattern.test(text)) return aisle
  }
  return 'Other'
}

// Groups items into [{ aisle, items }] in AISLES order, leaving out empty
// aisles and keeping the items' own order within each aisle.
export function groupByAisle(items, getName = (item) => item.name) {
  const buckets = new Map(AISLES.map((aisle) => [aisle, []]))
  for (const item of items) buckets.get(aisleFor(getName(item))).push(item)
  return AISLES.filter((aisle) => buckets.get(aisle).length > 0).map((aisle) => ({ aisle, items: buckets.get(aisle) }))
}
