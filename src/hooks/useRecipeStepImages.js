import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Fetches a single recipe's per-step photos (see src/lib/pdfStepImages.js
// for how they're extracted, and the recipe_step_images migration for how
// they're stored), resolved to signed URLs the same way recipe covers are
// in RecipeCatalogue.jsx.
//
// Returns stepImageUrls: an array aligned by index with recipe.steps (i.e.
// stepImageUrls[i] is the photo for steps[i]) — but ONLY when the photos
// found for this recipe are a complete, gapless 0..N-1 set whose count
// exactly matches the number of parsed steps. Extraction (at upload time)
// and parsing (afterward, once Gemini responds) run independently, so
// there's no guarantee they'll agree — if they don't, we can't be confident
// a given photo pairs with the right step, so this returns [] rather than
// risk showing a wrong one. Same fail-safe approach as the blank-cover fix.
export function useRecipeStepImages(recipeId, stepCount) {
  const [stepImageUrls, setStepImageUrls] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!recipeId || !stepCount) {
      setStepImageUrls([])
      return
    }

    let cancelled = false
    setLoading(true)

    supabase
      .from('recipe_step_images')
      .select('step_index, storage_path')
      .eq('recipe_id', recipeId)
      .order('step_index', { ascending: true })
      .then(async ({ data, error }) => {
        if (cancelled) return

        const isCompleteMatch =
          !error &&
          data &&
          data.length === stepCount &&
          data.every((row, i) => row.step_index === i)

        if (!isCompleteMatch) {
          if (error) console.error('Failed to load step images:', error)
          setStepImageUrls([])
          setLoading(false)
          return
        }

        const { data: signed, error: signError } = await supabase.storage
          .from('recipe-pdfs')
          .createSignedUrls(data.map(row => row.storage_path), 3600)

        if (cancelled) return
        if (signError || !signed) {
          console.error('Failed to sign step image URLs:', signError)
          setStepImageUrls([])
        } else {
          const urlByPath = {}
          signed.forEach(s => { if (s.signedUrl) urlByPath[s.path] = s.signedUrl })
          const ordered = data.map(row => urlByPath[row.storage_path] ?? null)
          setStepImageUrls(ordered.every(Boolean) ? ordered : [])
        }
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [recipeId, stepCount])

  return { stepImageUrls, loading }
}
