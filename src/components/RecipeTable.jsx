import { useState } from 'react'
import { FileText, RefreshCw, Loader2, ArrowUp, ArrowDown, ArrowUpDown, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import RecipeDeleteMenu from '@/components/RecipeDeleteMenu'
import WeekListButton from '@/components/WeekListButton'
import { RECIPE_TABLE_COLUMNS as COLUMNS, sortRecipes, formatRecipeCell, isEstimated } from '@/lib/recipeSort'

// Filled dots in the Difficulty pill (shape as well as colour, so it reads without colour vision).
const DIFFICULTY_LEVELS = { easy: 1, medium: 2, hard: 3 }

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
    <div className="flex flex-col gap-2.5">
    <div className="overflow-x-auto rounded-[18px] border border-border bg-card">
      <table className="w-full min-w-[980px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-input text-left">
            {COLUMNS.map(column => {
              const isActive = sort.column === column.key
              const numeric = column.type === 'number'
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={isActive ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                  className="p-0 whitespace-nowrap"
                >
                  <button
                    type="button"
                    className={`flex h-11 items-center gap-1 px-3 text-[13px] font-semibold transition-colors hover:text-foreground ${numeric ? 'ml-auto' : ''} ${isActive ? 'text-primary-text' : 'text-muted-foreground'}`}
                    onClick={() => toggleSort(column.key)}
                  >
                    {column.key === 'name' ? 'Recipe' : column.label}
                    {isActive ? (
                      sort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-40" />
                    )}
                  </button>
                </th>
              )
            })}
            <th scope="col" className="p-0"><span className="sr-only">This week and actions</span></th>
          </tr>
        </thead>
        <tbody>
          {sortedRecipes.map(recipe => {
            const isSelected = selectedIds.includes(recipe.id)
            const by = profiles[recipe.uploaded_by]?.display_name
            return (
              <tr
                key={recipe.id}
                className={`border-b border-border last:border-0 cursor-pointer transition-colors hover:bg-accent/60 ${isSelected ? 'bg-primary/10' : ''}`}
                onClick={() => onSelect(recipe)}
              >
                {COLUMNS.map(column => {
                  if (column.key === 'name') {
                    return (
                      <td key={column.key} className="p-3 whitespace-nowrap">
                        <span className="flex items-center gap-3">
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-muted">
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
                          </span>
                          <span className="flex flex-col gap-0.5">
                            <span className="text-[15px] font-semibold">{recipe.name ?? recipe.filename}</span>
                            {by && <span className="text-[13px] text-muted-foreground">by {by}</span>}
                          </span>
                        </span>
                      </td>
                    )
                  }
                  const cell = formatRecipeCell(recipe, column)
                  const numeric = column.type === 'number'
                  const tdClass = `p-3 whitespace-nowrap ${numeric ? 'text-right tabular-nums' : ''}`
                  if (column.key === 'difficulty' && !cell.empty) {
                    const level = DIFFICULTY_LEVELS[String(cell.text).toLowerCase()] ?? 0
                    return (
                      <td key={column.key} className={tdClass}>
                        <span className="inline-flex items-center gap-1.5">
                          {level > 0 && (
                            <span className="inline-flex gap-0.5" aria-hidden="true">
                              {[1, 2, 3].map(dot => (
                                <span key={dot} className={`h-1.5 w-1.5 rounded-full ${dot <= level ? 'bg-primary' : 'bg-primary/25'}`} />
                              ))}
                            </span>
                          )}
                          {cell.text}
                        </span>
                      </td>
                    )
                  }
                  if (column.key === 'protein_source' && !cell.empty) {
                    return (
                      <td key={column.key} className={tdClass}>
                        <span className="rounded-full bg-secondary/15 px-2.5 py-1 text-[13px] font-semibold text-secondary">{cell.text}</span>
                      </td>
                    )
                  }
                  return (
                    <td key={column.key} className={tdClass}>
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
                <td className="p-3">
                  <div className="flex items-center justify-end gap-1">
                    {adminMode && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-primary-text"
                        disabled={reparsing === recipe.id}
                        onClick={(e) => onReparse(recipe.id, e)}
                        title="Re-parse recipe (admin)"
                      >
                        {reparsing === recipe.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                    {canDelete(recipe) && (
                      <RecipeDeleteMenu
                        variant="row"
                        recipe={recipe}
                        deleting={deleting === recipe.id}
                        onDelete={onDelete}
                      />
                    )}
                    {onToggle && (
                      <WeekListButton inList={isSelected} onClick={() => onToggle(recipe)} size="h-10 w-10" />
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
      <p className="flex items-center gap-1 px-1 text-[13px] text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        <span><span className="italic">~ values</span> are AI estimates from the ingredient list, where the recipe card doesn&apos;t print them. Recipes still being read show up in Gallery.</span>
      </p>
    )}
    </div>
  )
}
