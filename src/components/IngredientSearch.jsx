import { useEffect, useRef, useState } from 'react'
import { Search, Loader2, X } from 'lucide-react'
import { Input } from '@/components/ui/input'

export default function IngredientSearchBar({
  query,
  onQueryChange,
  suggestions,
  loading,
  selected,
  onSelect,
  onRemove,
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handlePick(term) {
    onSelect(term)
    onQueryChange('')
    setOpen(false)
  }

  const availableSuggestions = suggestions.filter(s => !selected.includes(s))

  return (
    <div ref={containerRef} className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(term => (
            <span
              key={term}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs font-medium pl-2.5 pr-1.5 py-1"
            >
              {term}
              <button
                type="button"
                onClick={() => onRemove(term)}
                className="rounded-full p-0.5 hover:bg-primary/20"
                aria-label={`Remove ${term}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
          {loading
            ? <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
            : <Search className="h-4 w-4 text-muted-foreground" />
          }
        </div>
        <Input
          type="text"
          placeholder={selected.length ? 'Add another ingredient…' : 'Search by ingredient… e.g. chicken'}
          value={query}
          onChange={e => { onQueryChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          className="pl-9"
        />
        {open && availableSuggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover text-popover-foreground shadow-md max-h-60 overflow-y-auto">
            {availableSuggestions.map(term => (
              <li key={term}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={() => handlePick(term)}
                >
                  {term}
                </button>
              </li>
            ))}
          </ul>
        )}
        {open && query.trim().length >= 2 && !loading && availableSuggestions.length === 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover text-popover-foreground shadow-md px-3 py-2 text-sm text-muted-foreground">
            No matching ingredients
          </div>
        )}
      </div>
    </div>
  )
}
