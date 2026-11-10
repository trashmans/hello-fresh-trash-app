import { useState } from 'react'
import { MoreHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

// A "⋯" menu with "Delete recipe…", then a confirmation, so a stray click
// can't delete a recipe (the old trash icon deleted on one click).
// variant "card": the button sits in the card's top-right corner and the
// confirmation covers the card (the card must be position: relative).
// variant "row": both sit inline in a list-view row.
// Clicks are stopped here so they don't also open the recipe preview.
export default function RecipeDeleteMenu({ recipe, onDelete, deleting = false, variant = 'card' }) {
  const [confirming, setConfirming] = useState(false)
  const stop = (e) => e.stopPropagation()
  const name = recipe.name ?? recipe.filename

  function confirmDelete(e) {
    setConfirming(false)
    onDelete(recipe, e)
  }

  if (confirming && variant === 'row') {
    return (
      <div className="flex items-center gap-1" onClick={stop}>
        <span className="text-xs text-muted-foreground">Delete?</span>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setConfirming(false)}>Cancel</Button>
        <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" disabled={deleting} onClick={confirmDelete}>Delete</Button>
      </div>
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`More actions for ${name}`}
            disabled={deleting}
            onClick={stop}
            className={variant === 'card'
              ? 'absolute top-2 right-2 h-8 w-8 bg-card/90 shadow-sm text-muted-foreground hover:text-foreground'
              : 'h-7 w-7 text-muted-foreground hover:text-foreground'}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={stop}>
          <DropdownMenuItem className="cursor-pointer gap-2 text-destructive focus:text-destructive" onSelect={() => setConfirming(true)}>
            <Trash2 className="h-4 w-4" />
            Delete recipe…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {confirming && (
        <div
          role="alertdialog"
          aria-label={`Delete ${name}?`}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-[inherit] bg-card/95 p-4 text-center text-card-foreground"
          onClick={stop}
        >
          <p className="text-sm font-semibold">Delete “{name}”?</p>
          <p className="text-xs text-muted-foreground">This can't be undone.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button size="sm" variant="destructive" disabled={deleting} onClick={confirmDelete}>Delete</Button>
          </div>
        </div>
      )}
    </>
  )
}
