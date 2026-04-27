import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'

export default function RecipePreviewPanel({ recipe, onClose }) {
  const [url, setUrl] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!recipe) return

    setUrl(null)
    setError(null)

    async function fetchSignedUrl() {
      const { data, error } = await supabase.storage
        .from('recipe-pdfs')
        .createSignedUrl(recipe.storage_path, 60)

      if (error) {
        console.error('Signed URL error:', error)
        setError(`Could not load PDF preview: ${error.message ?? 'unknown error'}`)
        return
      }

      setUrl(data.signedUrl)
    }

    fetchSignedUrl()
  }, [recipe])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h3 className="font-semibold truncate">{recipe.name ?? recipe.filename}</h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!error && !url && <p className="text-sm text-muted-foreground">Loading preview…</p>}
      {url && (
        <iframe
          src={url}
          className="flex-1 w-full rounded border border-border min-h-0"
          title={recipe.name ?? recipe.filename}
        />
      )}
    </div>
  )
}
