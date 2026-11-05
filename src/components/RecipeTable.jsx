import { useState } from 'react'
import { FileText, ShoppingCart, Trash2, RefreshCw, Loader2, ArrowUp, ArrowDown, ArrowUpDown, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RECIPE_TABLE_COLUMNS as COLUMNS, sortRecipes, formatRecipeCell, isEstimated } from '@/lib/recipeSort'

const ESTIMATE_TOOLTIP = 'AI estimate from the ingredient list — not printed on the recipe card'

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

  const sortedRecipes = sortRecipes(recipes, sort.column, sort.direction)
  const anyEstimated = recipes.some(recipe =>
    COLUMNS.some(column => column.nutrition && isEstimated(recipe, column.key))
  )

  return (
    <div className="space-y-2">
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
                {COLUMNS.map(column => {
                  if (column.key === 'name') {
                    return (
                      <td key={column.key} className="px-3 py-2 whitespace-nowrap">
                        <span className="font-medium">{recipe.name ?? recipe.filename}</span>
                      </td>
                    )
                  }
                  const cell = formatRecipeCell(recipe, column)
                  return (
                    <td key={column.key} className="px-3 py-2 whitespace-nowrap">
                      {cell.estimated ? (
                        <span className="inline-flex items-center gap-1 italic text-muted-foreground" title={ESTIMATE_TOOLTIP}>
                          {cell.text}
                          <Sparkles className="h-3 w-3" aria-label="AI estimate" />
                        </span>
                      ) : (
                        <span className={cell.empty ? 'text-muted-foreground' : ''}>{cell.text}</span>
                      )}
                    </td>
                  )
                })}
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
    {anyEstimated && (
      <p className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        <span><span className="italic">~ values</span> are AI estimates from the ingredient list, where the recipe card doesn't print them.</span>
      </p>
    )}
    </div>
  )
}
