// Scales and merges ingredients from the recipes selected for the shopping list.
//
// Lines are merged when they are the same ingredient in compatible units, even
// if recipes write them differently. Real examples this handles:
//   "Olive Oil 1 TBSP" + "Olive oil 6 tsp" + "Olive Oil 3 T"   → Olive Oil 6 tbsp
//   "Sweet Potato 1"   + "Sweet Potatoes 2"                     → Sweet Potato 3
//   "Vegetable Stock Concentrate 1" + "Veggie Stock Concentrate 0.5" → 1.5
//
// Name matching ignores case and extra spaces, reads a plural last word as
// singular, and maps a few known synonyms. It deliberately does NOT use
// canonical_name: parse-recipe strips adjectives for search ("chicken breast"
// and "chicken thighs" both become "chicken"), and those must stay separate.
//
// Units: measurements (tbsp, tsp, cup, g, kg, oz…) of the same kind are added
// in base units and shown in the first recipe's unit. When the viewer's unit
// preferences are passed and that unit is in the other system (e.g. tbsp for a
// metric user), the line is converted the same way the recipe view converts
// (90 mL, not 6 tbsp). Volume and weight are never combined. Anything else is a count; "unit", "piece", "whole" and a
// blank unit are the same count, and plural count units read as singular.

import { normalizeUnit, bestUnitInSystem } from './units'

// Words that mean the same thing in ingredient names. Extend as new pairs show up.
const WORD_SYNONYMS = { veggie: 'vegetable', veggies: 'vegetables' }

// Unit words that just mean "this many".
const PLAIN_COUNT_UNITS = new Set(['', 'unit', 'units', 'piece', 'pieces', 'pc', 'pcs', 'whole', 'each'])

// Display labels for canonical units that are not written in lowercase.
const UNIT_LABELS = { ml: 'mL', l: 'L' }

// Units that belong to the metric system; everything else measured is US.
const METRIC_UNITS = new Set(['ml', 'l', 'g', 'kg'])

// Simple English plural → singular, for matching only (display keeps the recipe's wording).
function singular(word) {
  if (word.length <= 3 || /(ss|us|is)$/.test(word)) return word   // grass, couscous, asparagus, hummus
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`         // berries → berry
  if (/(ch|sh|x|z)es$/.test(word)) return word.slice(0, -2)        // radishes → radish, bunches → bunch
  if (word.endsWith('oes')) return word.slice(0, -2)               // potatoes → potato
  if (word.endsWith('s')) return word.slice(0, -1)                 // beans → bean, cloves → clove
  return word
}

const cleanName = (name) => (name ?? '').trim().replace(/\s+/g, ' ')

function nameKey(name) {
  const words = cleanName(name).toLowerCase().split(' ').filter(Boolean).map(w => WORD_SYNONYMS[w] ?? w)
  if (words.length) words[words.length - 1] = singular(words[words.length - 1])
  return words.join(' ')
}

function preferredSystem(type, prefs) {
  if (!prefs) return null
  return (type === 'volume' ? prefs.volume_unit : prefs.mass_unit) ?? null
}

// Re-expresses a measured line in the viewer's preferred system when its unit is
// from the other one. Mutates the group built in mergeIngredients().
function convertToPreferred(group, prefs) {
  const preferred = preferredSystem(group.type, prefs)
  if (!preferred || preferred === group.system) return

  const known = group.contributions.map(c => c.scaledQty).filter(q => q != null)
  const total = group.computedQty ?? (known.length ? Math.max(...known) : 1)
  const target = bestUnitInSystem(total * group.toBase, group.type, preferred)
  if (!target) return

  const factor = group.toBase / target.toBase
  const convert = (qty) => (qty == null ? null : qty * factor)
  group.unit = target.label
  group.computedQty = convert(group.computedQty)
  for (const c of group.contributions) {
    c.scaledQty = convert(c.scaledQty)
    c.baseQty = convert(c.baseQty)
  }
}

// How an ingredient's unit groups: a measurement type, or a named count.
function readUnit(rawUnit, prefs) {
  const measured = normalizeUnit(rawUnit)
  if (measured) {
    // With preferences, the key includes the preferred system: saved ticks and
    // adjusted quantities are stored in the line's unit, so switching systems
    // must not let an old "3 tbsp" adjustment be read as 3 mL.
    const preferred = preferredSystem(measured.type, prefs)
    return {
      key: preferred ? `${measured.type}:${preferred}` : measured.type,
      label: UNIT_LABELS[measured.unit] ?? measured.unit,
      toBase: measured.toBase,
      type: measured.type,
      system: METRIC_UNITS.has(measured.unit) ? 'metric' : 'us',
    }
  }

  const word = (rawUnit ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (PLAIN_COUNT_UNITS.has(word)) return { key: 'count:', label: null, toBase: 1 }
  const countUnit = singular(word)
  return { key: `count:${countUnit}`, label: countUnit, toBase: 1 }
}

/**
 * Scales and merges ingredients from multiple recipe selections.
 *
 * @param {Array<{recipe_id: string, servings: number}>} recipeSelections
 * @param {Object<string, Array>} ingredientsMap  — { recipe_id: [ingredient rows] }
 * @param {Object<string, Object>} recipesMap     — { recipe_id: { id, name, servings } }
 * @param {Object} [prefs]                        — viewer's unit preferences ({ volume_unit, mass_unit }: 'us' | 'metric')
 * @returns {Array} merged line items sorted alphabetically by name. Each item's
 *   computedQty and every contribution's scaledQty / baseQty are in item.unit.
 */
export function mergeIngredients(recipeSelections, ingredientsMap, recipesMap, prefs = null) {
  const groups = new Map()

  for (const { recipe_id, servings: selectedServings } of recipeSelections) {
    const ingredients = ingredientsMap[recipe_id] ?? []
    const recipe = recipesMap[recipe_id]
    const baseServings = recipe?.servings ?? 1
    const scaleFactor = baseServings > 0 ? selectedServings / baseServings : 1

    for (const ing of ingredients) {
      const unit = readUnit(ing.unit, prefs)
      const key = `${nameKey(ing.name)}|${unit.key}`

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: cleanName(ing.name),
          unit: unit.label,
          preparation: ing.preparation ?? null,
          computedQty: 0,
          contributions: [],
          toBase: unit.toBase,   // the group's unit, for converting later contributions
          type: unit.type ?? null,
          system: unit.system ?? null,
        })
      }
      const group = groups.get(key)

      // Express this recipe's amount in the group's unit (e.g. 6 tsp → 2 tbsp).
      const toGroupUnit = (qty) => (qty == null ? null : (qty * unit.toBase) / group.toBase)
      const baseQty = toGroupUnit(ing.quantity)
      const scaledQty = baseQty == null ? null : baseQty * scaleFactor

      group.computedQty = scaledQty != null && group.computedQty != null ? group.computedQty + scaledQty : null

      group.contributions.push({
        recipeName: recipe?.name ?? recipe_id,
        scaledQty,
        baseQty,
        scaleFactor,
        selectedServings,
        baseServings,
      })
    }
  }

  return Array.from(groups.values())
    .map(group => {
      if (group.type) convertToPreferred(group, prefs)
      const { toBase, type, system, ...item } = group
      return item
    })
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
}
