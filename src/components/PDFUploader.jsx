import { useRef, useState } from 'react'
import { ChevronDown, FileUp, Link2, Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useUploadQueue } from '@/hooks/useUploadQueue'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { checkRecipeUrl, linkFilename } from '../../supabase/functions/_shared/recipeLink.ts'
import UploadQueue from '@/components/UploadQueue'

// "Paste a link" (docs/adr/0009): checks the link, then saves a recipe row with source_url
// and no PDF. The webhook runs parse-recipe, which reads the page; the gallery shows it as
// "Reading your recipe…" (Realtime) like a PDF upload.
function LinkForm({ onClose, onAdded }) {
  const { session } = useAuth()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const check = text.trim() ? checkRecipeUrl(text) : null

  async function submit(e) {
    e.preventDefault()
    if (!check?.ok) return
    setBusy(true)
    const { error } = await supabase.from('recipes').insert({
      uploaded_by: session.user.id,
      filename: linkFilename(check.url),
      source_url: check.url,
    })
    setBusy(false)
    if (error) {
      toast.error(/rate limit/i.test(error.message) ? 'You have added 20 recipes in the last hour. Try again a bit later.' : `Could not add the link: ${error.message}`)
      return
    }
    toast.success('Reading your recipe… it appears in the gallery in about a minute.')
    onAdded?.()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[520px] flex-col gap-4 rounded-[22px] border border-border bg-card p-6 text-card-foreground shadow-xl"
        aria-labelledby="link-form-title"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="link-form-title" className="text-[22px] font-bold">Add a recipe from a link</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <input
          autoFocus
          type="url"
          inputMode="url"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://www.example.com/recipe"
          aria-label="Recipe link"
          className="h-12 rounded-xl border border-input bg-card px-3 text-base outline-none focus:ring-2 focus:ring-ring"
        />
        {check && !check.ok && <p className="text-sm text-destructive">{check.message}</p>}
        <p className="text-[13px] text-muted-foreground">
          Our server reads the page and Gemini turns it into a recipe, with the page&apos;s photo as its cover. The
          recipe links back to the original page. Recipes behind a paywall can&apos;t be read.
        </p>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !check?.ok} className="h-11 rounded-full px-5 font-semibold">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Add recipe
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} className="h-11 rounded-full px-5">Cancel</Button>
        </div>
      </form>
    </div>
  )
}

// "Add recipe" in the header: PDF files (as before) or a link to a recipe page.
export default function PDFUploader({ onUploadComplete }) {
  const inputRef = useRef(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const { queue, isRunning, summary, submit, clearQueue } = useUploadQueue({ onUploadComplete })

  function handleFileChange(e) {
    const files = e.target.files
    if (!files?.length) return
    submit(files)
    e.target.value = ''
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            disabled={isRunning}
            variant="outline"
            aria-label={isRunning ? 'Uploading recipes' : 'Add a recipe: PDF files or a link'}
            className="h-11 shrink-0 rounded-full px-3 sm:px-[18px] font-semibold"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="hidden sm:inline">Uploading…</span>
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Add recipe</span>
                <ChevronDown className="hidden h-3.5 w-3.5 sm:inline" aria-hidden="true" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => inputRef.current?.click()} className="gap-2 py-2.5">
            <FileUp className="h-4 w-4" /> PDF files
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setLinkOpen(true)} className="gap-2 py-2.5">
            <Link2 className="h-4 w-4" /> Paste a link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {linkOpen && <LinkForm onClose={() => setLinkOpen(false)} onAdded={onUploadComplete} />}
      <UploadQueue
        queue={queue}
        summary={summary}
        isRunning={isRunning}
        onClear={clearQueue}
      />
    </div>
  )
}
