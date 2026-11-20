import { useEffect, useRef, useState } from 'react'
import { Search, Loader2, X } from 'lucide-react'

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
  const inputRef = useRef(null)

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
    <div ref={containerRef} className="flex flex-col gap-2.5">
      <label htmlFor="ingredient-search" className="text-sm text-muted-foreground">
        Find recipes that use all of these ingredients
      </label>
      <div className="relative">
        <div
          className="flex min-h-14 flex-wrap items-center gap-2.5 rounded-2xl border border-input bg-card py-2 pl-4 pr-3 focus-within:ring-2 focus-within:ring-ring cursor-text"
          onClick={() => inputRef.current?.focus()}
        >
          {loading
            ? <Loader2 className="h-5 w-5 shrink-0 text-muted-foreground animate-spin" aria-hidden="true" />
            : <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          }
          {selected.map(term => (
            <span
              key={term}
              className="inline-flex h-[34px] items-center gap-1.5 rounded-full bg-secondary/15 pl-3 pr-1.5 text-sm font-semibold text-secondary"
            >
              {term}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRemove(term) }}
                className="flex h-[26px] w-[26px] items-center justify-center rounded-full hover:bg-secondary/20"
                aria-label={`Remove ${term}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            id="ingredient-search"
            type="search"
            autoComplete="off"
            placeholder={selected.length ? 'Add another ingredient…' : 'Add an ingredient, e.g. chicken'}
            value={query}
            onChange={e => { onQueryChange(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={e => {
              if (e.key === 'Backspace' && query === '' && selected.length > 0) onRemove(selected[selected.length - 1])
            }}
            className="h-10 min-w-0 flex-[1_1_220px] bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        {open && availableSuggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-xl border border-border bg-popover text-popover-foreground shadow-md max-h-60 overflow-y-auto py-1">
            {availableSuggestions.map(term => (
              <li key={term}>
                <button
                  type="button"
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={() => handlePick(term)}
                >
                  {term}
                </button>
              </li>
            ))}
          </ul>
        )}
        {open && query.trim().length >= 2 && !loading && availableSuggestions.length === 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-xl border border-border bg-popover text-popover-foreground shadow-md px-4 py-2.5 text-sm text-muted-foreground">
            No matching ingredients
          </div>
        )}
      </div>
    </div>
  )
}
