import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, ExternalLink, FileText, Minus, Plus, RotateCcw, Share2 } from 'lucide-react'
import SharePanel from '@/components/SharePanel'
import SwapProteinSection from '@/components/SwapProteinSection'
import { useSwapsById } from '@/hooks/useRecipeSwaps'
import { applySwap, swapModesFor } from '@/lib/proteinSwap'
import { supabase } from '@/lib/supabase'
import { useRecipeIngredients } from '@/hooks/useRecipeIngredients'
import { useRecipeStepImages } from '@/hooks/useRecipeStepImages'
import { useAuth } from '@/context/AuthContext'
import { convertIngredientUnit, formatTemperatureText, unitOptionsFor, unitOptionValueFor } from '@/lib/units'
import { computeScaleFactorFromServings, computeScaleFactorFromIngredient, scaleIngredients, scaleStepText } from '@/lib/scaling'
import { RECIPE_TABLE_COLUMNS, formatRecipeCell } from '@/lib/recipeSort'

// Amount ("2 tbsp") and name ("butter, softened") shown in two columns.
function ingredientParts(ingredient, unitPrefs) {
  const { quantity, unit } = convertIngredientUnit(ingredient.quantity, ingredient.unit, unitPrefs)
  const amount = [quantity != null ? String(quantity) : null, unit || null].filter(Boolean).join(' ')
  const name = ingredient.preparation ? `${ingredient.name}, ${ingredient.preparation}` : ingredient.name
  return { amount, name }
}

const segment = (active) =>
  `h-9 rounded-full px-4 text-sm font-semibold transition-colors ${
    active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
  }`

const fieldClass = 'h-11 rounded-xl border border-input bg-card px-3 text-base text-foreground'

// Scale-by-servings and scale-by-ingredient controls for the ingredients
// list below. Purely a view-time transform (see src/lib/scaling.js) —
// never writes anything back to the recipe or the shopping list.
function ScaleControls({ recipe, ingredients, scaleState, setScaleState, scaleFailed }) {
  const { mode, targetServings, ingredientId, targetQuantity, targetUnit } = scaleState
  const scalableIngredients = ingredients.filter(ing => ing.quantity != null)
  const selectedIngredient = scalableIngredients.find(ing => ing.id === ingredientId) ?? null

  function selectIngredient(id) {
    const ing = scalableIngredients.find(i => i.id === id)
    setScaleState({
      mode: 'ingredient',
      ingredientId: id,
      targetQuantity: ing?.quantity ?? '',
      targetUnit: unitOptionValueFor(ing?.unit),
    })
  }

  function stepServings(delta) {
    const current = Number(targetServings) || recipe.servings || 1
    setScaleState({ targetServings: Math.max(1, Math.round(current) + delta) })
  }

  const unitOptions = selectedIngredient ? unitOptionsFor(selectedIngredient.unit) : []
  const unitIsFixed = unitOptions.length <= 1
  const changed = mode === 'ingredient' || (mode === 'servings' && targetServings !== recipe.servings)

  return (
    <div className="flex flex-col gap-3.5 rounded-[22px] border border-border bg-banner p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[22px] font-bold">Scale recipe</h2>
        <div className="flex items-center gap-2">
          {changed && (
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setScaleState(recipe.servings ? { mode: 'servings', targetServings: recipe.servings } : { mode: null })}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Reset
            </button>
          )}
          <div role="group" aria-label="Scale by" className="flex gap-1 rounded-full border border-border bg-card p-1">
            <button
              type="button"
              aria-pressed={mode === 'servings'}
              disabled={recipe.servings == null}
              className={`${segment(mode === 'servings')} disabled:opacity-50`}
              onClick={() => setScaleState({ mode: 'servings', targetServings: recipe.servings ?? '' })}
            >
              By servings
            </button>
            <button
              type="button"
              aria-pressed={mode === 'ingredient'}
              disabled={scalableIngredients.length === 0}
              className={`${segment(mode === 'ingredient')} disabled:opacity-50`}
              onClick={() => selectIngredient(scalableIngredients[0]?.id)}
            >
              By ingredient amount
            </button>
          </div>
        </div>
      </div>

      {mode === 'servings' && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" aria-label="Fewer servings" onClick={() => stepServings(-1)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-input bg-card hover:bg-accent">
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="min-w-[120px] text-center font-display text-2xl font-bold" aria-live="polite">
            {targetServings || '?'} serving{Number(targetServings) === 1 ? '' : 's'}
          </span>
          <button type="button" aria-label="More servings" onClick={() => stepServings(1)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-input bg-card hover:bg-accent">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="text-sm text-muted-foreground">
            The card is for {recipe.servings}. Amounts in the steps scale too.
          </span>
        </div>
      )}

      {mode === 'ingredient' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">I have</span>
          <input
            type="number"
            min="0"
            step="any"
            aria-label="Amount you have"
            className={`${fieldClass} w-24`}
            value={targetQuantity}
            onChange={(e) => setScaleState({ targetQuantity: e.target.value === '' ? '' : Number(e.target.value) })}
          />
          {unitIsFixed ? (
            <span className="text-base">{targetUnit}</span>
          ) : (
            <select
              aria-label="Unit"
              className={fieldClass}
              value={targetUnit}
              onChange={(e) => setScaleState({ targetUnit: e.target.value })}
            >
              {unitOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
          <span className="text-muted-foreground">of</span>
          <select
            aria-label="Ingredient"
            className={`${fieldClass} flex-1 min-w-[10rem]`}
            value={ingredientId ?? ''}
            onChange={(e) => selectIngredient(e.target.value)}
          >
            {scalableIngredients.map(ing => (
              <option key={ing.id} value={ing.id}>{ing.name}</option>
            ))}
          </select>
        </div>
      )}

      {scaleFailed && (
        <p className="text-sm text-destructive">
          Enter a valid amount in a unit compatible with the recipe&apos;s (e.g. lb/kg, cups/mL, or the exact same unit).
        </p>
      )}
    </div>
  )
}

// "Photos from the page" (link recipes, docs/adr/0009): photos from the post whose
// step photos aren't tied to steps. Each opens full size in a new tab.
function PagePhotos({ paths }) {
  const [urls, setUrls] = useState([])
  const key = (paths ?? []).join('|')
  useEffect(() => {
    let cancelled = false
    setUrls([])
    if (!key) return undefined
    supabase.storage.from('recipe-pdfs').createSignedUrls(key.split('|'), 3600).then(({ data }) => {
      if (!cancelled) setUrls((data ?? []).map(d => d.signedUrl).filter(Boolean))
    })
    return () => { cancelled = true }
  }, [key])
  if (urls.length === 0) return null
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[22px] font-bold">Photos from the page</h2>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {urls.map((url, i) => (
          <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="shrink-0" aria-label={`Open photo ${i + 1} of ${urls.length}`}>
            <img src={url} alt="" loading="lazy" className="h-36 w-auto rounded-[14px] object-cover sm:h-44" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          </a>
        ))}
      </div>
    </section>
  )
}

// swap: { row, mode } when a protein swap is chosen — applied before any scaling.
function InstructionsView({ recipe, swap = null }) {
  const { unitPrefs } = useAuth()
  const { ingredients: originalIngredients, loading } = useRecipeIngredients(recipe.id)
  const originalSteps = recipe.steps ?? []
  const { stepImageUrls } = useRecipeStepImages(recipe.id, originalSteps.length, { allowGaps: Boolean(recipe.source_url) })
  const swapped = useMemo(
    () => applySwap({ ingredients: originalIngredients, steps: originalSteps, swap: swap?.row ?? null, mode: swap?.mode }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [originalIngredients, recipe.steps, swap?.row, swap?.mode]
  )
  const ingredients = swapped.ingredients
  const steps = swapped.steps ?? []
  // The step photos belong to the original steps; keep them only if the steps still line up.
  const showStepImages = steps === originalSteps || steps.length === originalSteps.length
  const initialScale = () => (recipe.servings ? { mode: 'servings', targetServings: recipe.servings } : { mode: null })
  const [scaleState, setScaleStateRaw] = useState(initialScale)

  // Reset any active scaling when the viewer switches to a different
  // recipe — a scale chosen for one recipe shouldn't silently carry over
  // and misrepresent another.
  useEffect(() => {
    setScaleStateRaw(recipe.servings ? { mode: 'servings', targetServings: recipe.servings } : { mode: null })
  }, [recipe.id, recipe.servings])

  function setScaleState(patch) {
    setScaleStateRaw(prev => ({ ...prev, ...patch }))
  }

  let scaleFactor = null
  if (scaleState.mode === 'servings') {
    scaleFactor = computeScaleFactorFromServings(scaleState.targetServings, recipe.servings)
  } else if (scaleState.mode === 'ingredient') {
    const scaledIngredient = ingredients.find(ing => ing.id === scaleState.ingredientId)
    scaleFactor = computeScaleFactorFromIngredient(scaledIngredient, scaleState.targetQuantity, scaleState.targetUnit)
  }
  const scaleFailed = scaleState.mode != null && scaleFactor == null
  const displayIngredients = scaleFactor != null ? scaleIngredients(ingredients, scaleFactor) : ingredients

  return (
    <div className="flex flex-col gap-8">
      {!loading && ingredients.length > 0 && (
        <ScaleControls
          recipe={recipe}
          ingredients={ingredients}
          scaleState={scaleState}
          setScaleState={setScaleState}
          scaleFailed={scaleFailed}
        />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-[28px] font-bold">Ingredients</h2>
        {loading && <p className="text-sm text-muted-foreground">Loading ingredients…</p>}
        {!loading && ingredients.length === 0 && (
          <p className="text-sm text-muted-foreground">No ingredients recorded for this recipe.</p>
        )}
        {!loading && ingredients.length > 0 && (
          <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            {displayIngredients.map(ing => {
              const { amount, name } = ingredientParts(ing, unitPrefs)
              return (
                <li key={ing.id} className="flex gap-3 border-b border-border py-3 text-[15px]">
                  <span className="min-w-[72px] font-semibold text-primary-text">{amount}</span>
                  <span>
                    {name}
                    {ing.swap === 'added' && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[12px] font-semibold text-primary-text">swap</span>}
                    {ing.swap === 'halved' && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[12px] font-semibold text-muted-foreground">half</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[28px] font-bold">Steps</h2>
        {steps.length === 0 && (
          <p className="text-sm text-muted-foreground">No instructions recorded for this recipe.</p>
        )}
        {steps.length > 0 && (
          <ol className="flex flex-col gap-5">
            {steps.map((step, i) => (
              <li key={i} className="flex flex-wrap items-start gap-5">
                {showStepImages && stepImageUrls[i] && (
                  <img
                    src={stepImageUrls[i]}
                    alt=""
                    className="aspect-video w-full object-cover rounded-[14px] sm:w-[200px] sm:flex-[0_0_200px]"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                )}
                <div className="flex min-w-0 flex-[1_1_260px] gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 font-bold text-primary-text" aria-hidden="true">
                    {i + 1}
                  </span>
                  <p className="mt-1 text-base leading-relaxed">
                    <span className="sr-only">Step {i + 1}: </span>
                    {formatTemperatureText(scaleStepText(step, scaleFactor, unitPrefs), unitPrefs.temperature_unit)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {recipe.source_url && <PagePhotos paths={recipe.page_images} />}
    </div>
  )
}

function PdfView({ recipe }) {
  const [url, setUrl] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setUrl(null)
    setError(null)

    supabase.storage
      .from('recipe-pdfs')
      .createSignedUrl(recipe.storage_path, 60)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('Signed URL error:', error)
          setError(`Could not load PDF preview: ${error.message ?? 'unknown error'}`)
          return
        }
        setUrl(data.signedUrl)
      })

    return () => { cancelled = true }
  }, [recipe])

  return (
    <div className="flex flex-col">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!error && !url && <p className="text-sm text-muted-foreground">Loading preview…</p>}
      {url && (
        <iframe
          src={url}
          className="h-[75vh] w-full rounded-[18px] border border-border bg-card"
          title={recipe.name ?? recipe.filename}
        />
      )}
    </div>
  )
}

const NUTRITION = [
  { key: 'calories_kcal', label: 'kcal', bare: true },
  { key: 'protein_g', label: 'protein' },
  { key: 'fat_g', label: 'fat' },
  { key: 'fibre_g', label: 'fibre' },
]

function NutritionCard({ recipe, swapped = false }) {
  const cells = NUTRITION.map(n => {
    const column = RECIPE_TABLE_COLUMNS.find(c => c.key === n.key)
    const cell = formatRecipeCell(recipe, column)
    // "780 kcal" → "780"; the unit is the label underneath.
    const text = n.bare && !cell.empty ? cell.text.replace(/\s*kcal$/, '') : cell.text
    return { ...n, ...cell, text }
  })
  if (cells.every(c => c.empty)) return null
  const anyEstimated = cells.some(c => c.estimated)

  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-5">
      <h2 className="font-sans text-[15px] font-semibold">Nutrition per serving</h2>
      <div className="grid grid-cols-4 gap-3">
        {cells.map(c => (
          <div key={c.key}>
            <p className={`font-display text-[22px] font-bold ${c.empty ? 'text-muted-foreground' : ''}`}>{c.text}</p>
            <p className="text-[13px] text-muted-foreground">{c.label}</p>
          </div>
        ))}
      </div>
      {anyEstimated && (
        <p className="text-[13px] text-muted-foreground">~ estimated from the ingredients; the card didn&apos;t print it.</p>
      )}
      {swapped && <p className="text-[13px] text-muted-foreground">For the original recipe, without the protein swap.</p>}
    </div>
  )
}

// Signed URL for the cover and the uploader's name, fetched here so the
// detail page doesn't depend on what the gallery happened to load.
function useRecipeExtras(recipe) {
  const [coverUrl, setCoverUrl] = useState(null)
  const [uploader, setUploader] = useState(null)

  useEffect(() => {
    let cancelled = false
    setCoverUrl(null)
    setUploader(null)
    if (recipe.cover_path) {
      supabase.storage.from('recipe-pdfs').createSignedUrl(recipe.cover_path, 3600)
        .then(({ data }) => { if (!cancelled && data?.signedUrl) setCoverUrl(data.signedUrl) })
    }
    if (recipe.uploaded_by) {
      supabase.from('profiles').select('display_name').eq('id', recipe.uploaded_by).maybeSingle()
        .then(({ data }) => { if (!cancelled && data?.display_name) setUploader(data.display_name) })
    }
    return () => { cancelled = true }
  }, [recipe.id, recipe.cover_path, recipe.uploaded_by])

  return { coverUrl, uploader }
}

// Full-page recipe view inside the Recipes tab: cover, facts, nutrition and
// the add-to-week button on the left; Instructions (scaling, ingredients,
// steps) or the original PDF on the right. Columns stack on narrow screens.
// pick: this recipe's selection in this week's list (with swap_id / swap_mode), if any.
export default function RecipePreviewPanel({ recipe, onClose, inList = false, onToggle, pick = null, onSetSwap, onAddWithSwap }) {
  const [tab, setTab] = useState('instructions')
  const swapModes = recipe.status === 'ready' ? swapModesFor(recipe) : null
  const pickChoice = useMemo(
    () => (pick?.swap_id ? { mode: pick.swap_mode, swapId: pick.swap_id } : { mode: 'original', swapId: null }),
    [pick?.swap_id, pick?.swap_mode]
  )
  const [choice, setChoice] = useState(pickChoice)
  const [rowsById, setRowsById] = useState({})
  // The household's saved swap wins whenever it changes (another member may have changed it).
  useEffect(() => { if (inList) setChoice(pickChoice) }, [inList, pickChoice])
  const fetched = useSwapsById(choice.swapId && !rowsById[choice.swapId] ? [choice.swapId] : [])
  const swapRow = choice.mode !== 'original' && choice.swapId ? (rowsById[choice.swapId] ?? fetched[choice.swapId] ?? null) : null
  const activeSwap = swapRow ? { row: swapRow, mode: choice.mode } : null

  const handleSwapChange = useCallback((next, row) => {
    if (row) setRowsById(prev => ({ ...prev, [row.id]: row }))
    setChoice(next)
    if (!inList || !onSetSwap) return
    if (next.mode === 'original') onSetSwap(recipe.id, null, null)
    else if (next.swapId) onSetSwap(recipe.id, next.swapId, next.mode)
  }, [inList, onSetSwap, recipe.id])

  function handleToggle() {
    if (!inList && activeSwap && onAddWithSwap) onAddWithSwap(recipe, swapRow.id, choice.mode)
    else onToggle(recipe)
  }
  const [sharing, setSharing] = useState(false)
  const { coverUrl, uploader } = useRecipeExtras(recipe)
  const name = recipe.name ?? recipe.filename
  // Link recipes (docs/adr/0009): the site they came from, e.g. "budgetbytes.com".
  let sourceHost = null
  try { sourceHost = recipe.source_url ? new URL(recipe.source_url).hostname.replace(/^www\./, '') : null } catch { /* no host */ }

  useEffect(() => { setTab('instructions') }, [recipe.id])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const eyebrow = [recipe.cuisine, recipe.protein_source].filter(Boolean).join(' · ')
  const facts = [
    recipe.prep_time_minutes != null && `Prep ${recipe.prep_time_minutes} min`,
    recipe.cook_time_minutes != null && `Cook ${recipe.cook_time_minutes} min`,
    recipe.servings != null && `Serves ${recipe.servings}`,
    recipe.difficulty,
  ].filter(Boolean)

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-7 px-4 py-6 lg:px-6 lg:py-8">
      <button
        type="button"
        onClick={onClose}
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] font-semibold hover:text-primary-text transition-colors"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All recipes
      </button>

      <div className="flex flex-wrap items-start gap-10">
        <section className="flex min-w-0 flex-[1_1_380px] flex-col gap-5">
          <div className="aspect-[4/3] overflow-hidden rounded-[22px] bg-muted">
            {coverUrl ? (
              <img src={coverUrl} alt="" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                <FileText className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {eyebrow && <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-secondary">{eyebrow}</p>}
            <h1 className="text-[32px] sm:text-[40px] font-bold leading-[1.05] tracking-[-0.01em]">{name}</h1>
            {(uploader || sourceHost) && (
              <p className="text-[15px] text-muted-foreground">
                {[sourceHost ? `From ${sourceHost}` : null, uploader ? `added by ${uploader}` : null].filter(Boolean).join(' · ').replace(/^added/, 'Added')}
              </p>
            )}
          </div>
          {facts.length > 0 && (
            <div className="flex flex-wrap gap-2 text-sm">
              {facts.map(f => (
                <span key={f} className="rounded-full border border-border bg-card px-3 py-2">{f}</span>
              ))}
            </div>
          )}
          <div className="flex gap-2.5">
            {onToggle && (
              <button
                type="button"
                aria-pressed={inList}
                onClick={handleToggle}
                className={`flex h-[52px] flex-1 items-center justify-center gap-2 rounded-[14px] text-base font-bold transition-opacity hover:opacity-90 ${
                  inList ? 'bg-secondary text-secondary-foreground' : 'bg-primary text-primary-foreground'
                }`}
              >
                {inList ? <><Check className="h-5 w-5" aria-hidden="true" />In this week&apos;s list</> : <><Plus className="h-5 w-5" aria-hidden="true" />Add to this week</>}
              </button>
            )}
            {recipe.status === 'ready' && (
              <button
                type="button"
                aria-expanded={sharing}
                onClick={() => setSharing(s => !s)}
                className="flex h-[52px] items-center justify-center gap-2 rounded-[14px] border border-input bg-card px-5 text-base font-semibold hover:bg-accent transition-colors"
              >
                <Share2 className="h-5 w-5" aria-hidden="true" /> Share
              </button>
            )}
          </div>
          {sharing && <SharePanel recipe={recipe} onClose={() => setSharing(false)} />}
          {swapModes && (
            <SwapProteinSection recipe={recipe} modes={swapModes} choice={choice} onChange={handleSwapChange} inList={inList} />
          )}
          <NutritionCard recipe={recipe} swapped={activeSwap != null} />
        </section>

        <section className="flex min-w-0 flex-[999_1_560px] flex-col gap-6">
          <div role="tablist" aria-label="Recipe" className="flex gap-1 self-start rounded-full border border-border bg-card p-1">
            <button role="tab" type="button" aria-selected={tab === 'instructions'} className={segment(tab === 'instructions')} onClick={() => setTab('instructions')}>
              Instructions
            </button>
            {recipe.storage_path && (
              <button role="tab" type="button" aria-selected={tab === 'pdf'} className={segment(tab === 'pdf')} onClick={() => setTab('pdf')}>
                Original PDF
              </button>
            )}
          </div>
          {recipe.source_url && (
            <a
              href={recipe.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="-mt-2 inline-flex items-center gap-1.5 self-start text-sm font-semibold text-primary-text underline underline-offset-2"
            >
              Original page on {sourceHost} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
          {tab === 'pdf' && recipe.storage_path ? <PdfView recipe={recipe} /> : <InstructionsView recipe={recipe} swap={activeSwap} />}
        </section>
      </div>
    </div>
  )
}
