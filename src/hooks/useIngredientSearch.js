import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const MAX_SUGGESTIONS = 8

/**
 * Typeahead suggestions for the ingredient search box.
 * Queries real, stored ingredient values (not free text) so the dropdown
 * only ever offers things that actually exist in the catalogue.
 */
export function useIngredientSuggestions(query) {
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const term = (query ?? '').trim()

    if (term.length < 2) {
      setSuggestions([])
      setLoading(false)
      return
    }

    setLoading(true)
    let cancelled = false

    const timer = setTimeout(async () => {
      const { data, error } = await supabase
        .from('ingredients')
        .select('canonical_name, name')
        .or(`canonical_name.ilike.%${term}%,name.ilike.%${term}%`)
        .limit(100)

      if (cancelled) return

      if (error || !data) {
        setSuggestions([])
        setLoading(false)
        return
      }

      const unique = [...new Set(
        data.map(row => row.canonical_name ?? row.name).filter(Boolean)
      )].sort((a, b) => a.localeCompare(b))

      setSuggestions(unique.slice(0, MAX_SUGGESTIONS))
      setLoading(false)
    }, 250)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])

  return { suggestions, loading }
}

/**
 * Given a list of selected ingredient chips, finds recipes that contain
 * EVERY selected ingredient (AND match), keyed by recipe id.
 */
export function useIngredientFilter(selected) {
  const [matches, setMatches] = useState(null)
  const [loading, setLoading] = useState(false)
  const key = selected.join('|')

  useEffect(() => {
    if (selected.length === 0) {
      setMatches(null)
      setLoading(false)
      return
    }

    setLoading(true)
    let cancelled = false

    ;(async () => {
      const orParts = selected.flatMap(term => [
        `canonical_name.ilike.%${term}%`,
        `name.ilike.%${term}%`,
      ])

      const { data, error } = await supabase
        .from('ingredients')
        .select('recipe_id, canonical_name, name')
        .or(orParts.join(','))
        .limit(1000)

      if (cancelled) return

      if (error || !data) {
        setMatches(null)
        setLoading(false)
        return
      }

      // Group ingredient rows by recipe, tracking which selected chips
      // each recipe has at least one ingredient matching.
      const recipeChipSets = new Map()
      for (const row of data) {
        const matchedChips = selected.filter(term => {
          const t = term.toLowerCase()
          return (
            (row.canonical_name ?? '').toLowerCase().includes(t) ||
            (row.name ?? '').toLowerCase().includes(t)
          )
        })
        if (matchedChips.length === 0) continue
        const existing = recipeChipSets.get(row.recipe_id) ?? new Set()
        matchedChips.forEach(c => existing.add(c))
        recipeChipSets.set(row.recipe_id, existing)
      }

      // AND match: keep only recipes that matched every selected chip.
      const result = new Map()
      for (const [recipeId, chipSet] of recipeChipSets) {
        if (chipSet.size === selected.length) {
          result.set(recipeId, [...chipSet])
        }
      }

      setMatches(result)
      setLoading(false)
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { matches, loading }
}
