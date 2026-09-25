import { useState } from 'react'
import { FileText, ShoppingCart, Trash2, RefreshCw, Loader2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Column definitions for the sortable list view. `key` must match a
// column on the recipes table directly (all written by parse-recipe, see
// its ParsedRecipe interface) so sorting can just compare raw values.
const COLUMNS = [
  { key: 'name', label: 'Name', type: 'string' },
  { key: 'cook_time_minutes', label: 'Cook time', type: 'number', format: (v) => v != null ? `${v} min` : '—' },
  { key: 'prep_time_minutes', label: 'Prep time', type: 'number', format: (v) => v != null ? `${v} min` : '—' },
  { key: 'difficulty', label: 'Difficulty', type: 'string' },
  { key: 'cuisine', label: 'Cuisine', type: 'string' },
  { key: 'protein_source', label: 'Protein', type: 'string' },
]

function compareValues(a, b, column) {
  const av = a[column.key]
  const bv = b[column.key]
  if (av == null && bv == null) return 0
  if (av == null) return 1 // nulls always sort last, regardless of direction
  if (bv == null) return -1
  if (column.type === 'number') return av - bv
  return String(av).localeCompare(String(bv))
}

function formatCell(recipe, column) {
  const value = recipe[column.key]
  if (column.format) return column.format(value)
  return value ?? '—'
}

export default function RecipeTable({
  recipes,
  coverUrls,
  profiles,
  selectedIds,
  onSelect,
  onToggle,
  canDelete,
  onDelete,
  deleting,
  adminMode,
  onReparse,
  reparsing,
}) {
  const [sort, setSort] = useState({ column: null, direction: 'asc' })

  function toggleSort(columnKey) {
    setSort(prev =>
      prev.column === columnKey
        ? { column: columnKey, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column: columnKey, direction: 'asc' }
    )
  }

  const activeColumn = COLUMNS.find(c => c.key === sort.column)
  const sortedRecipes = activeColumn
    ? [...recipes].sort((a, b) => compareValues(a, b, activeColumn) * (sort.direction === 'asc' ? 1 : -1))
    : recipes

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left">
            <th className="w-10 px-3 py-2" />
            {COLUMNS.map(column => {
              const isActive = sort.column === column.key
              return (
                <th key={column.key} className="px-3 py-2 font-medium whitespace-nowrap">
                  <button
                    className="flex items-center gap-1 hover:text-primary transition-colors"
                    onClick={() => toggleSort(column.key)}
                  >
                    {column.label}
                    {isActive ? (
                      sort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />
                    )}
                  </button>
                </th>
              )
            })}
            <th className="px-3 py-2 font-medium">Uploaded by</th>
            <th className="w-24 px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {sortedRecipes.map(recipe => {
            const isSelected = selectedIds.includes(recipe.id)
            return (
              <tr
                key={recipe.id}
                className={`border-b border-border last:border-0 cursor-pointer hover:bg-accent/50 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}
                onClick={() => onSelect(recipe)}
              >
                <td className="px-3 py-2">
                  <div className="h-8 w-8 rounded bg-muted flex items-center justify-center overflow-hidden shrink-0">
                    {coverUrls[recipe.cover_path] ? (
                      <img
                        src={coverUrls[recipe.cover_path]}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={(e) => { e.currentTarget.style.display = 'none' }}
                      />
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </td>
                {COLUMNS.map(column => (
                  <td key={column.key} className="px-3 py-2 whitespace-nowrap">
                    {column.key === 'name' ? (
                      <span className="font-medium">{recipe.name ?? recipe.filename}</span>
                    ) : (
                      <span className={formatCell(recipe, column) === '—' ? 'text-muted-foreground' : ''}>
                        {formatCell(recipe, column)}
                      </span>
                    )}
                  </td>
                ))}
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                  {profiles[recipe.uploaded_by]?.display_name ?? 'Unknown'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    {onToggle && (
                      <button
                        className={`rounded p-1 transition-colors ${
                          isSelected
                            ? 'text-primary bg-primary/15'
                            : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
                        }`}
                        onClick={(e) => { e.stopPropagation(); onToggle(recipe) }}
                        title={isSelected ? 'Remove from shopping list' : 'Add to shopping list'}
                      >
                        <ShoppingCart className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {adminMode && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-primary"
                        disabled={reparsing === recipe.id}
                        onClick={(e) => onReparse(recipe.id, e)}
                        title="Re-parse recipe (admin)"
                      >
                        {reparsing === recipe.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                    {canDelete(recipe) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        disabled={deleting === recipe.id}
                        onClick={(e) => onDelete(recipe, e)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
