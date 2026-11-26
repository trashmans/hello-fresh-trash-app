// Equipment tags (air fryer, Instant Pot, wok…), read from a recipe's name and steps
// rather than stored, so every recipe has them without a reparse. Whole phrases only:
// "blend the spices" is not a blender, and a plain oven is not a tag. A step such as
// "if you don't have an air fryer…" still counts. Pure: no I/O.

const RULES = [
  ['Air fryer', /\bair[\s-]?fr(?:y|yer|ier|ied|ying)\b/i],
  ['Instant Pot', /\binstant[\s-]?pot\b|\bpressure[\s-]?cook(?:er|ed|ing|s)?\b/i],
  ['Slow cooker', /\bslow[\s-]?cook(?:er|ed|ing|s)?\b|\bcrock[\s-]?pot\b/i],
  ['Blender', /\bblender\b/i],
  ['Food processor', /\bfood[\s-]?processor\b/i],
  ['Stand mixer', /\bstand[\s-]?mixer\b|\bkitchenaid\b/i],
  ['Wok', /\bwok\b/i],
  ['Dutch oven', /\bdutch[\s-]?oven\b/i],
  ['Cast-iron pan', /\bcast[\s-]?iron\b/i],
]

/** The tags, in the order they are shown. */
export const EQUIPMENT = RULES.map(([label]) => label)

const cache = new WeakMap()

/** The equipment a recipe uses, in EQUIPMENT order, each once. */
export function detectEquipment(recipe) {
  if (!recipe || typeof recipe !== 'object') return []
  if (cache.has(recipe)) return cache.get(recipe)
  const steps = Array.isArray(recipe.steps) ? recipe.steps : []
  const text = [recipe.name, ...steps].filter((s) => typeof s === 'string').join('\n')
  const tags = text ? RULES.filter(([, re]) => re.test(text)).map(([label]) => label) : []
  cache.set(recipe, tags)
  return tags
}

/** The tags used by at least one of the recipes, in EQUIPMENT order (for the filter chips). */
export function equipmentInUse(recipes) {
  const used = new Set((recipes ?? []).flatMap(detectEquipment))
  return EQUIPMENT.filter((label) => used.has(label))
}

/** The recipes that use every chosen tag; the same array when none is chosen. */
export function filterByEquipment(recipes, chosen) {
  if (!chosen || chosen.length === 0) return recipes
  return recipes.filter((r) => { const tags = detectEquipment(r); return chosen.every((c) => tags.includes(c)) })
}
