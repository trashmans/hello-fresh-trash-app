import { useEffect, useState, useCallback, useMemo } from 'react'
import { FileText, Trash2, RotateCcw, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { renderPdfCoverBlob } from '@/lib/pdfCover'
import RecipeTable from '@/components/RecipeTable'
import { useFriendIds } from '@/hooks/useSocial'
import RecipeDeleteMenu from '@/components/RecipeDeleteMenu'
import WeekListButton from '@/components/WeekListButton'
import { RECIPE_FILTERS, normalizeRecipeFilter, filterRecipes } from '@/lib/recipeFilter'
import { recipeCardMeta, catalogueHeading, weekListNote } from '@/lib/recipeCard'
import { STATUS_POLL_MS, isInProgress, inProgressIdsToCheck, mergeStatusUpdates, recipeCardState } from '@/lib/recipeStatus'

const VIEW_MODE_STORAGE_KEY = 'recipeCatalogueViewMode'
const OWNER_FILTER_STORAGE_KEY = 'recipeCatalogueOwnerFilter'

function loadOwnerFilter() {
  try {
    return normalizeRecipeFilter(localStorage.getItem(OWNER_FILTER_STORAGE_KEY))
  } catch {
    return 'all'
  }
}

function loadViewMode() {
  try {
    return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'icon'
  } catch {
    return 'icon'
  }
}

// Shared frame for the cards that aren't a finished recipe yet (queued,
// failed, duplicate): the same 4:3 tile as a recipe, dashed, with the
// message inside and the filename underneath.
function StatusTile({ tone = 'muted', icon, title, children }) {
  const frame = tone === 'error'
    ? 'border-destructive/50 bg-destructive/5 text-destructive'
    : 'border-input bg-card text-muted-foreground'
  return (
    <article className="flex flex-col gap-3">
      <div className={`aspect-[4/3] rounded-[18px] border border-dashed flex flex-col items-center justify-center gap-2.5 p-4 text-center ${frame}`}>
        {icon}
        <span className="text-sm font-medium">{title}</span>
      </div>
      {children}
    </article>
  )
}

function PendingCard({ recipe, onDelete, deleting }) {
  const label = recipe.status === 'processing' ? 'Reading your recipe…' : 'Queued…'
  return (
    <StatusTile
      icon={<Loader2 className="h-6 w-6 animate-spin text-primary-text" aria-hidden="true" />}
      title={label}
    >
      <div className="flex flex-col gap-1" aria-busy="true">
        <h3 className="text-[17px] font-semibold leading-snug text-muted-foreground truncate">{recipe.filename}</h3>
        <p className="text-sm text-muted-foreground">Usually under a minute</p>
      </div>
      {/* No Cancel for a recipe being re-parsed on someone else's behalf:
          cancelling deletes the recipe. */}
      {onDelete && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start rounded-full text-destructive hover:text-destructive"
          disabled={deleting}
          onClick={() => onDelete(recipe)}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Cancel
        </Button>
      )}
    </StatusTile>
  )
}

function RejectedCard({ recipe, existingRecipe, onSelect, onDelete, deleting }) {
  const existingLabel = existingRecipe?.name ?? existingRecipe?.filename ?? 'existing recipe'

  return (
    <StatusTile tone="error" icon={<FileText className="h-6 w-6" aria-hidden="true" />} title="Already in the catalogue">
      <div className="flex flex-col gap-1 min-w-0">
        <h3 className="text-[17px] font-semibold leading-snug truncate">{recipe.filename}</h3>
        {existingRecipe && (
          <button
            className="text-sm text-primary-text underline text-left truncate"
            onClick={() => onSelect(existingRecipe)}
          >
            View: {existingLabel}
          </button>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="self-start rounded-full text-destructive hover:text-destructive"
        disabled={deleting}
        onClick={() => onDelete(recipe)}
      >
        <Trash2 className="h-3.5 w-3.5 mr-1" />
        Delete
      </Button>
    </StatusTile>
  )
}

function FailedCard({ recipe, onRetry, onDelete, deleting, retrying }) {
  // No onRetry when retrying isn't possible (e.g. retry limit reached outside admin mode).
  const maxRetries = !onRetry

  return (
    <StatusTile tone="error" icon={<FileText className="h-6 w-6" aria-hidden="true" />} title="Couldn't read this recipe">
      <div className="flex flex-col gap-1 min-w-0">
        <h3 className="text-[17px] font-semibold leading-snug truncate">{recipe.filename}</h3>
        {maxRetries && <p className="text-sm text-muted-foreground">Please delete and re-upload</p>}
      </div>
      <div className="flex gap-2">
        {!maxRetries && (
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            disabled={retrying}
            onClick={() => onRetry(recipe.id)}
          >
            {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
            Retry
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full text-destructive hover:text-destructive"
          disabled={deleting}
          onClick={() => onDelete(recipe)}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Delete
        </Button>
      </div>
    </StatusTile>
  )
}

export default function RecipeCatalogue({ refreshKey, onSelect, onDelete, selectedIds = [], onToggle, ingredientMatches = null, ingredientTerms = [] }) {
  const { session, adminMode } = useAuth()
  const [recipes, setRecipes] = useState([])
  const [profiles, setProfiles] = useState({})
  const [coverUrls, setCoverUrls] = useState({})
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(null)
  const [retrying, setRetrying] = useState(null)
  const [reparsing, setReparsing] = useState(null)
  // Recipes re-parsed this session (admin), so their progress is followed even
  // when someone else uploaded them. See inProgressIdsToCheck().
  const [reparseWatch, setReparseWatch] = useState(() => new Set())
  const [backfilling, setBackfilling] = useState(false)
  const [viewMode, setViewModeRaw] = useState(loadViewMode)
  const [ownerFilter, setOwnerFilterRaw] = useState(loadOwnerFilter)
  const friendIds = useFriendIds()

  function setOwnerFilter(filter) {
    setOwnerFilterRaw(filter)
    try {
      localStorage.setItem(OWNER_FILTER_STORAGE_KEY, filter)
    } catch {
      // Same as the view mode: remembered per device when storage allows.
    }
  }

  function setViewMode(mode) {
    setViewModeRaw(mode)
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
    } catch {
      // Per-device persistence is a nicety, not load-bearing — if storage
      // is unavailable (private browsing, quota, etc.) the toggle still
      // works for the rest of this session, it just won't be remembered.
    }
  }

  const fetchRecipes = useCallback(async () => {
    setLoading(true)

    // Own recipes at any status + all ready recipes from others
    // Admin mode loads every recipe so admins can see and rescue other people's
    // failed ones; recipeCardState() decides which of them get a card.
    let query = supabase.from('recipes').select('*')
    if (!adminMode) query = query.or(`status.eq.ready,uploaded_by.eq.${session.user.id}`)
    const { data, error } = await query.order('created_at', { ascending: false })

    if (error || !data) {
      setLoading(false)
      return
    }

    setRecipes(data)

    // Fetch uploader profiles
    const uploaderIds = [...new Set(data.map(r => r.uploaded_by).filter(Boolean))]
    if (uploaderIds.length > 0) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', uploaderIds)

      if (profileData) {
        const map = {}
        profileData.forEach(p => { map[p.id] = p })
        setProfiles(map)
      }
    }

    // Batch-sign cover thumbnail URLs (one request instead of one per card)
    const coverPaths = [...new Set(data.map(r => r.cover_path).filter(Boolean))]
    if (coverPaths.length > 0) {
      const { data: signedCovers } = await supabase.storage
        .from('recipe-pdfs')
        .createSignedUrls(coverPaths, 3600)

      if (signedCovers) {
        const map = {}
        signedCovers.forEach(s => { if (s.signedUrl) map[s.path] = s.signedUrl })
        setCoverUrls(map)
      }
    } else {
      setCoverUrls({})
    }

    setLoading(false)
  }, [session.user.id, adminMode])

  useEffect(() => {
    fetchRecipes()
  }, [fetchRecipes, refreshKey])

  // Covers that arrive after the list was loaded (a link recipe's photo is stored by
  // parse-recipe when it finishes, and reaches us through Realtime or the status check)
  // get their signed URL here, so the thumbnail shows without reloading the page.
  const missingCoverKey = useMemo(
    () => [...new Set(recipes.map(r => r.cover_path).filter(p => p && !coverUrls[p]))].sort().join('|'),
    [recipes, coverUrls]
  )
  useEffect(() => {
    if (!missingCoverKey) return undefined
    let cancelled = false
    supabase.storage.from('recipe-pdfs').createSignedUrls(missingCoverKey.split('|'), 3600).then(({ data }) => {
      if (cancelled || !data) return
      const signed = Object.fromEntries(data.filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]))
      if (Object.keys(signed).length) setCoverUrls(prev => ({ ...prev, ...signed }))
    })
    return () => { cancelled = true }
  }, [missingCoverKey])

  // Realtime subscription for the current user's recipe status changes.
  // The channel name is unique per mount: React StrictMode (development) mounts,
  // unmounts and remounts immediately, and re-using a fixed name could attach the
  // second mount to the channel that is still being removed, so no updates arrive.
  useEffect(() => {
    const channel = supabase
      .channel(`own-recipe-updates-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'recipes',
          filter: `uploaded_by=eq.${session.user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setRecipes(prev => {
              if (prev.some(r => r.id === payload.new.id)) return prev
              return [payload.new, ...prev]
            })
          } else if (payload.eventType === 'UPDATE') {
            setRecipes(prev =>
              prev.map(r => r.id === payload.new.id ? { ...r, ...payload.new } : r)
            )
          } else if (payload.eventType === 'DELETE') {
            setRecipes(prev => prev.filter(r => r.id !== payload.old.id))
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [session.user.id])

  // Safety net for missed Realtime events: while any of my recipes is still
  // pending or processing, re-check their status every STATUS_POLL_MS and when
  // the tab becomes visible again. Stops as soon as nothing is in progress.
  const inProgressKey = useMemo(
    () => inProgressIdsToCheck(recipes, session.user.id, reparseWatch).join(','),
    [recipes, session.user.id, reparseWatch]
  )

  useEffect(() => {
    if (!inProgressKey) return undefined
    const ids = inProgressKey.split(',')
    let cancelled = false

    async function checkStatuses() {
      const { data: statusRows } = await supabase
        .from('recipes')
        .select('id, status')
        .in('id', ids)
      if (cancelled || !statusRows) return

      // Recipes that finished need their full row (name, times, tags…) for the card.
      const finishedIds = statusRows.filter(r => !isInProgress(r.status)).map(r => r.id)
      let fullRows = []
      if (finishedIds.length > 0) {
        const { data } = await supabase.from('recipes').select('*').in('id', finishedIds)
        if (cancelled) return
        fullRows = data ?? []
      }

      const stillRunning = statusRows.filter(r => isInProgress(r.status))
      setRecipes(prev => mergeStatusUpdates(prev, [...stillRunning, ...fullRows]))
    }

    function checkWhenVisible() {
      if (document.visibilityState === 'visible') checkStatuses()
    }

    const timer = setInterval(checkStatuses, STATUS_POLL_MS)
    document.addEventListener('visibilitychange', checkWhenVisible)
    window.addEventListener('focus', checkWhenVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', checkWhenVisible)
      window.removeEventListener('focus', checkWhenVisible)
    }
  }, [inProgressKey])

  async function handleDelete(recipe, e) {
    e?.stopPropagation()
    setDeleting(recipe.id)
    const toastId = toast.loading('Deleting recipe…')

    try {
      // Step image rows are cascade-deleted with the recipe row itself, but
      // that doesn't remove their underlying Storage files — those have to
      // be listed and deleted explicitly, the same as the PDF and cover.
      const { data: stepImages } = await supabase
        .from('recipe_step_images')
        .select('storage_path')
        .eq('recipe_id', recipe.id)

      const pathsToDelete = [
        recipe.storage_path,
        recipe.cover_path,
        ...(stepImages ?? []).map(row => row.storage_path),
      ].filter(Boolean)
      if (pathsToDelete.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('recipe-pdfs')
          .remove(pathsToDelete)
        if (storageError) throw storageError
      }

      const { error: dbError } = await supabase
        .from('recipes')
        .delete()
        .eq('id', recipe.id)
      if (dbError) throw dbError

      setRecipes(prev => prev.filter(r => r.id !== recipe.id))
      onDelete?.(recipe)
      toast.success('Recipe deleted.', { id: toastId })
    } catch (err) {
      toast.error(`Delete failed: ${err.message ?? 'unknown error'}`, { id: toastId })
    } finally {
      setDeleting(null)
    }
  }

  async function handleRetry(recipeId) {
    setRetrying(recipeId)
    try {
      const { error } = await supabase.functions.invoke('retry-parse', {
        body: { recipeId },
      })
      if (error) throw error
    } catch (err) {
      toast.error(`Retry failed: ${err.message ?? 'unknown error'}`)
    } finally {
      setRetrying(null)
    }
  }

  async function handleReparse(recipeId, e) {
    e?.stopPropagation()
    setReparsing(recipeId)
    const toastId = toast.loading('Queuing re-parse…')
    try {
      const { error } = await supabase.functions.invoke('admin-reparse', {
        body: { recipeId },
      })
      if (error) throw error
      // Show it as queued straight away and keep checking it until it is ready,
      // even if someone else uploaded it.
      setReparseWatch(prev => new Set(prev).add(recipeId))
      setRecipes(prev => mergeStatusUpdates(prev, [{ id: recipeId, status: 'pending' }]))
      toast.success('Recipe queued for re-parsing.', { id: toastId })
    } catch (err) {
      toast.error(`Re-parse failed: ${err.message ?? 'unknown error'}`, { id: toastId })
    } finally {
      setReparsing(null)
    }
  }

  // Only PDF recipes: a cover is rendered from the PDF (link recipes get the page's photo, or none).
  const recipesMissingCovers = recipes.filter(r => r.status === 'ready' && !r.cover_path && r.storage_path)

  async function handleBackfillCovers() {
    const targets = recipesMissingCovers
    if (targets.length === 0) return

    setBackfilling(true)
    const toastId = toast.loading(`Generating covers\u2026 0/${targets.length}`)
    let done = 0
    let succeeded = 0

    for (const recipe of targets) {
      try {
        const { data: pdfBlob, error: downloadError } = await supabase.storage
          .from('recipe-pdfs')
          .download(recipe.storage_path)
        if (downloadError || !pdfBlob) throw downloadError ?? new Error('download failed')

        const arrayBuffer = await pdfBlob.arrayBuffer()
        const coverBlob = await renderPdfCoverBlob(arrayBuffer)
        if (!coverBlob) throw new Error('render failed')

        // Uploaded under the *current* (admin) user's own path so this satisfies
        // the standard "own path" storage policy — no special admin storage
        // policy needed. Ownership of the recipe itself is unaffected.
        const coverStoragePath = `covers/${session.user.id}/${crypto.randomUUID()}.jpg`
        const { error: uploadError } = await supabase.storage
          .from('recipe-pdfs')
          .upload(coverStoragePath, coverBlob, { contentType: 'image/jpeg' })
        if (uploadError) throw uploadError

        const { error: setCoverError } = await supabase.functions.invoke('admin-set-cover', {
          body: { recipeId: recipe.id, coverPath: coverStoragePath },
        })
        if (setCoverError) throw setCoverError

        succeeded++
      } catch (err) {
        console.warn(`Backfill failed for recipe ${recipe.id}:`, err)
      } finally {
        done++
        toast.loading(`Generating covers\u2026 ${done}/${targets.length}`, { id: toastId })
      }
    }

    toast.success(`Generated ${succeeded} of ${targets.length} covers.`, { id: toastId })
    setBackfilling(false)
    fetchRecipes()
  }

  // ingredientMatches already contains only recipes matching every
  // selected ingredient chip (AND match) — see useIngredientFilter.
  // The owner filter (all / mine / friends) applies first; friends come from the Social tab.
  const ownerRecipes = filterRecipes(recipes, ownerFilter, { userId: session.user.id, friendIds })
  const displayRecipes = ingredientMatches
    ? ownerRecipes.filter(r => r.status === 'ready' ? ingredientMatches.has(r.id) : true)
    : ownerRecipes

  // List view only applies to ready recipes — columns like cook time
  // don't mean anything for a still-processing upload, so pending/failed/
  // rejected recipes keep rendering as their existing small cards
  // regardless of viewMode (handled inline in the map below).
  const readyRecipes = displayRecipes.filter(r => r.status === 'ready')
  // Non-ready recipes that actually get a card (spacing above the list view).
  const nonReadyCount = displayRecipes.filter(r => {
    const card = recipeCardState(r, { userId: session.user.id, adminMode, watchedIds: reparseWatch })
    return card && card.kind !== 'ready'
  }).length

  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading recipes…</p>
  }

  if (recipes.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-7 w-7 text-primary-text" />}
        title="No recipes yet"
        text="Upload your first recipe card to get started — HelloFresh is our favorite, but anything works"
      />
    )
  }

  if (ingredientMatches && ownerRecipes.length > 0 && displayRecipes.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-7 w-7 text-muted-foreground" />}
        title="No matches found"
        text="None of your recipes contain those ingredients"
      />
    )
  }

  const canDelete = (recipe) =>
    recipe.uploaded_by === session?.user?.id || adminMode

  const pill = (active) =>
    `h-11 rounded-full border px-[18px] text-[15px] font-medium transition-colors ${
      active
        ? 'border-foreground bg-foreground text-background'
        : 'border-input bg-card text-foreground hover:bg-accent disabled:text-muted-foreground/60 disabled:hover:bg-card disabled:cursor-not-allowed'
    }`

  const segment = (active) =>
    `h-9 rounded-full px-4 text-sm font-semibold transition-colors ${
      active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
    }`

  function getDuplicateId(recipe) {
    const match = (recipe.rejection_reason ?? '').match(/^duplicate:(.+)$/)
    return match?.[1] ?? null
  }

  const inListCount = readyRecipes.filter(r => selectedIds.includes(r.id)).length
  const listNote = weekListNote(inListCount)

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show recipes" className="flex flex-wrap items-center gap-2">
          {RECIPE_FILTERS.map(f => {
            const unavailable = Boolean(f.needsSocial)
            const active = ownerFilter === f.key
            return (
              <button
                key={f.key}
                type="button"
                disabled={unavailable}
                aria-pressed={active}
                title={unavailable ? 'Comes with the Social tab' : undefined}
                onClick={() => setOwnerFilter(f.key)}
                className={pill(active)}
              >
                {f.label}
              </button>
            )
          })}
        </div>
        {adminMode && recipesMissingCovers.length > 0 ? (
          <Button
            variant="outline"
            className="h-11 rounded-full"
            disabled={backfilling}
            onClick={handleBackfillCovers}
          >
            {backfilling
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <RefreshCw className="h-4 w-4 mr-2" />
            }
            Generate {recipesMissingCovers.length} missing cover{recipesMissingCovers.length === 1 ? '' : 's'} (admin)
          </Button>
        ) : null}
        <div className="flex-[1_1_40px]" />
        <div role="group" aria-label="View" className="flex gap-1 rounded-full border border-border bg-card p-1">
          <button type="button" aria-pressed={viewMode === 'icon'} onClick={() => setViewMode('icon')} className={segment(viewMode === 'icon')}>
            Gallery
          </button>
          <button type="button" aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')} className={segment(viewMode === 'list')}>
            List
          </button>
        </div>
      </div>

      {ownerRecipes.length > 0 && (
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="text-[28px] font-bold">{catalogueHeading(readyRecipes.length, ingredientTerms)}</h2>
          {listNote && <span className="text-sm text-muted-foreground">{listNote}</span>}
        </div>
      )}

      {ownerRecipes.length === 0 && (
        <EmptyState
          title={ownerFilter === 'mine' ? "You haven't uploaded any recipes yet" : 'No recipes here yet'}
          text={ownerFilter === 'mine' ? 'Upload a recipe PDF, or switch to All recipes.'
            : ownerFilter === 'friends' ? (friendIds.length ? "Your friends haven't uploaded recipes yet." : 'Add friends on the Social tab, or switch to All recipes.')
            : 'Switch to All recipes to see everything.'}
        />
      )}

      <div className="@container">
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 @2xl:grid-cols-3 @4xl:grid-cols-4 @4xl:gap-6">
        {displayRecipes.map(recipe => {
        const card = recipeCardState(recipe, { userId: session.user.id, adminMode, watchedIds: reparseWatch })

        if (card?.kind === 'pending') {
          return (
            <PendingCard
              key={recipe.id}
              recipe={recipe}
              onDelete={card.canCancel ? (r) => handleDelete(r) : undefined}
              deleting={deleting === recipe.id}
            />
          )
        }

        if (card?.kind === 'rejected') {
          const dupeId = getDuplicateId(recipe)
          const existingRecipe = dupeId ? recipes.find(r => r.id === dupeId) : null
          return (
            <RejectedCard
              key={recipe.id}
              recipe={recipe}
              existingRecipe={existingRecipe}
              onSelect={onSelect}
              onDelete={(r) => handleDelete(r)}
              deleting={deleting === recipe.id}
            />
          )
        }

        if (card?.kind === 'failed') {
          const onRetry =
            card.retryVia === 'retry-parse' ? handleRetry
            : card.retryVia === 'admin-reparse' ? (id) => handleReparse(id)
            : undefined
          return (
            <FailedCard
              key={recipe.id}
              recipe={recipe}
              onRetry={onRetry}
              onDelete={(r) => handleDelete(r)}
              deleting={deleting === recipe.id}
              retrying={retrying === recipe.id || reparsing === recipe.id}
            />
          )
        }

        if (card?.kind === 'ready') {
          if (viewMode !== 'icon') return null
          const isSelected = selectedIds.includes(recipe.id)
          const name = recipe.name ?? recipe.filename
          const by = profiles[recipe.uploaded_by]?.display_name
          const meta = recipeCardMeta(recipe)
          return (
            <article key={recipe.id} className="flex min-w-0 flex-col gap-3">
              <div className="relative rounded-[18px]">
                <button
                  type="button"
                  onClick={() => onSelect(recipe)}
                  aria-label={`Open ${name}`}
                  className={`block w-full aspect-[4/3] overflow-hidden rounded-[18px] bg-muted transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
                >
                  {coverUrls[recipe.cover_path] ? (
                    <img
                      src={coverUrls[recipe.cover_path]}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center">
                      <FileText className="h-8 w-8 text-muted-foreground" />
                    </span>
                  )}
                </button>
                {recipe.protein_source && (
                  <span className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-md bg-secondary px-2 py-1 text-xs font-semibold text-secondary-foreground">
                    {recipe.protein_source}
                  </span>
                )}
                {adminMode && (
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={reparsing === recipe.id}
                    onClick={(e) => handleReparse(recipe.id, e)}
                    className="absolute bottom-2 right-2 h-8 w-8 bg-card/90 shadow-sm text-muted-foreground hover:text-primary-text"
                    title="Re-parse recipe (admin)"
                  >
                    {reparsing === recipe.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <RefreshCw className="h-4 w-4" />}
                  </Button>
                )}
                {canDelete(recipe) && (
                  <RecipeDeleteMenu
                    recipe={recipe}
                    deleting={deleting === recipe.id}
                    onDelete={(r, e) => handleDelete(r, e)}
                  />
                )}
              </div>
              <button type="button" onClick={() => onSelect(recipe)} className="flex flex-col gap-1 text-left">
                <h3 className="text-[17px] font-semibold leading-snug line-clamp-2">{name}</h3>
                {by && <p className="text-sm text-muted-foreground">by {by}</p>}
              </button>
              <div className="mt-auto flex items-center gap-3 text-[13px] text-muted-foreground">
                <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5">
                  {meta.map(part => <span key={part} className="whitespace-nowrap">{part}</span>)}
                </span>
                {onToggle && (
                  <WeekListButton inList={isSelected} onClick={() => onToggle(recipe)} className="ml-auto" />
                )}
              </div>
            </article>
          )
        }

        return null
      })}
      </div>
      </div>
      {viewMode === 'list' && readyRecipes.length > 0 && (
        <div className={nonReadyCount > 0 ? 'mt-4' : ''}>
          <RecipeTable
            recipes={readyRecipes}
            coverUrls={coverUrls}
            profiles={profiles}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onToggle={onToggle}
            canDelete={canDelete}
            onDelete={(r, e) => handleDelete(r, e)}
            deleting={deleting}
            adminMode={adminMode}
            onReparse={handleReparse}
            reparsing={reparsing}
          />
        </div>
      )}
    </section>
  )
}

function EmptyState({ icon, title, text }) {
  return (
    <div className="flex flex-col items-center rounded-[28px] border border-border bg-card px-6 py-14 text-center">
      {icon && (
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          {icon}
        </div>
      )}
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </div>
  )
}
