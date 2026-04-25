import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export function parseTerms(raw) {
  return [...new Set(
    (raw ?? '').split(/[,\s]+/)
      .map(t => t.replace(/[^a-zA-Z0-9'\-]/g, '').trim())
      .filter(t => t.length >= 2)
  )]
}

export function useIngredientSearch(query) {
  const [matches, setMatches] = useState(null)
  const [loading, setLoading] = useState(false)
  const [termCount, setTermCount] = useState(0)

  useEffect(() => {
    const terms = parseTerms(query)
    setTermCount(terms.length)

    if (terms.length === 0) {
      setMatches(null)
      setLoading(false)
      return
    }

    setLoading(true)

    const timer = setTimeout(async () => {
      const orParts = terms.flatMap(term => [
        `canonical_name.ilike.%${term}%`,
        `name.ilike.%${term}%`,
      ])

      const { data, error } = await supabase
        .from('ingredients')
        .select('recipe_id, canonical_name, name')
        .or(orParts.join(','))
        .limit(200)

      if (error || !data) {
        setMatches(null)
        setLoading(false)
        return
      }

      // Group ingredient rows by recipe, count how many distinct terms matched
      const recipeTerms = new Map()
      for (const row of data) {
        const matchedTerms = terms.filter(term => {
          const t = term.toLowerCase()
          return (
            (row.canonical_name ?? '').toLowerCase().includes(t) ||
            (row.name ?? '').toLowerCase().includes(t)
          )
        })
        const existing = recipeTerms.get(row.recipe_id) ?? new Set()
        matchedTerms.forEach(t => existing.add(t))
        recipeTerms.set(row.recipe_id, existing)
      }

      const countMap = new Map()
      for (const [recipeId, termSet] of recipeTerms) {
        countMap.set(recipeId, termSet.size)
      }

      setMatches(countMap)
      setLoading(false)
    }, 300)

    return () => clearTimeout(timer)
  }, [query])

  return { matches, loading, termCount }
}
