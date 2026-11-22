import { useEffect } from 'react'
import { Check, RefreshCw } from 'lucide-react'
import { SWAP_MODES } from '@/lib/proteinSwap'
import { useRecipeSwapOptions } from '@/hooks/useRecipeSwaps'

const segment = (active) =>
  `h-9 rounded-full px-4 text-sm font-semibold transition-colors ${
    active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
  }`

// Swap protein (docs/adr/0010): Original / All vegetarian (or All with meat) / Half & half,
// then one of Gemini's options for this recipe. The options are saved per recipe, so they
// load straight away after the first time; "Suggest other options" asks for a new batch.
// choice = { mode, swapId }; onChange(nextChoice, swapRow) — the parent applies and saves it.
export default function SwapProteinSection({ recipe, modes, choice, onChange, inList }) {
  const { direction } = modes
  const labels = SWAP_MODES[direction]
  const { options, loading, error, load, more } = useRecipeSwapOptions(recipe.id, direction)
  const swapping = choice.mode !== 'original'

  // Load the options the first time a swap mode is picked (or when the pick already has one).
  useEffect(() => {
    if (swapping && options === null && !loading && !error) load()
  }, [swapping, options, loading, error, load])

  // A swap mode with no option chosen yet takes the first one, so the page changes at once.
  useEffect(() => {
    if (swapping && !choice.swapId && options?.length) onChange({ ...choice, swapId: options[0].id }, options[0])
  }, [swapping, choice, options, onChange])

  function pickMode(mode) {
    if (mode === 'original') return onChange({ mode: 'original', swapId: null }, null)
    const row = options?.find(o => o.id === choice.swapId) ?? null
    onChange({ mode, swapId: row?.id ?? choice.swapId ?? null }, row)
  }

  return (
    <section className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-5" aria-label="Swap protein">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-sans text-[15px] font-semibold">Swap protein</h2>
        <div role="radiogroup" aria-label="Protein" className="flex flex-wrap gap-1 rounded-full border border-border bg-background p-1">
          {modes.modes.map(m => (
            <button key={m} type="button" role="radio" aria-checked={choice.mode === m} className={segment(choice.mode === m)} onClick={() => pickMode(m)}>
              {labels[m]}
            </button>
          ))}
        </div>
      </div>

      {swapping && (
        <>
          {choice.mode === 'half' && (
            <p className="text-[13px] text-muted-foreground">
              Half the servings keep the {direction === 'to_vegetarian' ? 'meat or fish' : 'vegetarian protein'}, half get the swap.
              {direction === 'to_vegetarian' && ' Stock and other shared bases go vegetarian for the whole dish.'}
            </p>
          )}
          {loading && <p className="text-sm text-muted-foreground" aria-live="polite">Asking Gemini for ideas… this can take up to a minute the first time.</p>}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}{' '}
              <button type="button" className="font-semibold underline underline-offset-2" onClick={load}>Try again</button>
            </p>
          )}
          {options?.length === 0 && !loading && <p className="text-sm text-muted-foreground">No options for this recipe yet.</p>}
          {options?.length > 0 && (
            <ul className="flex flex-col gap-2" role="radiogroup" aria-label="Swap options">
              {options.map(o => {
                const active = o.id === choice.swapId
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => onChange({ ...choice, swapId: o.id }, o)}
                      className={`flex w-full items-start gap-3 rounded-[14px] border p-3 text-left transition-colors ${
                        active ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'
                      }`}
                    >
                      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>
                        {active && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-semibold">{o.title}</span>
                        {o.summary && <span className="text-sm text-muted-foreground">{o.summary}</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {options !== null && (
            <button
              type="button"
              disabled={loading}
              onClick={more}
              className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-primary-text hover:underline disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Suggest other options
            </button>
          )}
          <p className="text-[13px] text-muted-foreground">
            {inList
              ? "Saved for this week's pick — the Shopping tab and AH order use it, for everyone in your household."
              : "Add the recipe to this week and this swap goes on the list with it."}
          </p>
        </>
      )}
    </section>
  )
}
