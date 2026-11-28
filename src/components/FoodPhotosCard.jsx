import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, Check, ImageOff, Loader2, Lock, MapPin, Trash2, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FOOD_PHOTO_LIMIT, photoPlan } from '@/lib/foodPhotos'
import { readPhotoBatch, shrinkPhoto } from '@/lib/photoShrink'
import { addPhotoArgs, cellKey, foodPhotoErrorMessage, foodPhotoPaths, lookupCells, visibilityLabel } from '@/lib/foodPhotoUpload'
import { addFoodPhoto, getFoodPhotoDefault, placeSearch, useFoodPhotos } from '@/hooks/useFoodPhotos'
import FoodPhotoEditSheet from '@/components/FoodPhotoEditSheet'
import PlacePicker, { Attribution } from '@/components/PlacePicker'

// Food photos on the Social tab (docs/adr/0012, F1d). Add photos or a Google Photos ZIP; the
// browser reads each photo's location and date, sends only the location rounded to ~10 km to
// find the nearest city, shrinks the photo (no metadata) and uploads it. Photos without a
// place can get one by search, or are added without one (not on the map). Who sees new photos
// comes from Settings. Below: my photos, newest first; tap one to change its place or who can
// see it (FoodPhotoEditSheet, F1e), or delete it.

const WORKERS = 3
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// A chosen photo shown large (whole photo, not cropped) while it gets a place.
function LargePreview({ url }) {
  const [broken, setBroken] = useState(false)
  return url && !broken
    ? <img src={url} alt="" onError={() => setBroken(true)} className="max-h-80 w-full rounded-[14px] bg-muted object-contain" />
    : null
}

function Preview({ url, className = 'h-14 w-14' }) {
  const [broken, setBroken] = useState(false)
  return url && !broken
    ? <img src={url} alt="" onError={() => setBroken(true)} className={`${className} shrink-0 rounded-lg object-cover`} />
    : <span className={`${className} flex shrink-0 items-center justify-center rounded-lg bg-muted`}><ImageOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></span>
}

// One photo without a place in the review list. The preview is 96 px; while a place is being
// added it shows full width (up to 320 px tall) so you can see which photo you're pinning.
function NoPlaceRow({ item, onSetPlace }) {
  const [picking, setPicking] = useState(false)
  const open = picking && !item.place
  return (
    <li className="space-y-2 py-2">
      <div className="flex items-center gap-3">
        {!open && <Preview url={item.previewUrl} className="h-24 w-24" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="text-[12px] text-muted-foreground">
            {item.place ? <><MapPin className="mr-1 inline h-3 w-3" aria-hidden="true" />{item.place.label}</> : item.lookupFailed ? 'No place found' : 'No location in the photo'}
            {item.exif?.takenOn ? ` · ${item.exif.takenOn}` : ''}
          </p>
        </div>
        {item.place ? (
          <button type="button" onClick={() => onSetPlace(null)} className="text-[13px] font-semibold text-primary-text underline underline-offset-2">Remove place</button>
        ) : !picking && (
          <button type="button" onClick={() => setPicking(true)} className="text-[13px] font-semibold text-primary-text underline underline-offset-2">Add a place</button>
        )}
      </div>
      {open && (
        <>
          <LargePreview url={item.previewUrl} />
          <PlacePicker onPick={(p) => { onSetPlace(p); setPicking(false) }} onCancel={() => setPicking(false)} />
        </>
      )}
    </li>
  )
}

function PhotoTile({ photo, groupName, onOpen, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const Icon = photo.visibility === 'friends' ? Users : photo.visibility === 'only_me' ? Lock : Users
  async function del() {
    setBusy(true)
    const ok = await onDelete(photo)
    if (!ok) { setBusy(false); setConfirming(false) }
  }
  return (
    <li className="space-y-1">
      <div className="relative">
        <button type="button" onClick={() => onOpen(photo)} aria-label={`Change ${photo.place_name ?? 'photo'}`} className="block w-full">
          <Preview url={photo.thumbUrl} className="aspect-square w-full" />
        </button>
        {confirming ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-black/60 p-2 text-white">
            <span className="text-sm font-semibold">Delete?</span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={del} className="h-8 rounded-full px-3">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Yes
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(false)} className="h-8 rounded-full px-3">No</Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} aria-label="Delete photo" className="absolute right-1 top-1 rounded-full bg-black/55 p-1.5 text-white hover:bg-black/75">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className="truncate text-[12px] font-medium">{photo.place_name ?? 'No place'}</p>
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden="true" />{visibilityLabel(photo.visibility, groupName)}{photo.taken_on ? ` · ${photo.taken_on}` : ''}
      </p>
    </li>
  )
}

export default function FoodPhotosCard({ groups = [] }) {
  const { me, photos, loading, reload, remove, update } = useFoodPhotos()
  const [editing, setEditing] = useState(null)
  const inputRef = useRef(null)
  const [step, setStep] = useState('idle') // idle | reading | finding | review | adding
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [batch, setBatch] = useState(null) // { items, unreadable, overLimit, visibility }

  const groupNames = useMemo(() => Object.fromEntries(groups.map(g => [g.id, g.name])), [groups])
  const room = Math.max(0, FOOD_PHOTO_LIMIT - photos.length)

  // Previews of the chosen photos, freed when the batch is done or the card goes away.
  const previews = useRef([])
  const freePreviews = () => { previews.current.forEach(u => URL.revokeObjectURL(u)); previews.current = [] }
  useEffect(() => freePreviews, [])

  async function choose(e) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (!files.length) return
    if (room === 0) { toast.error(foodPhotoErrorMessage('photo_limit')); return }
    setStep('reading')
    const [read, visibility] = await Promise.all([readPhotoBatch(files), getFoodPhotoDefault()])
    const plan = photoPlan(read, { room })
    const ready = [...plan.withLocation, ...plan.withoutLocation]
    if (!ready.length) {
      setStep('idle')
      toast.error(plan.unreadable.length ? "Those files couldn't be read as photos." : 'No photos found. Choose JPG, PNG, HEIC or a ZIP of photos.')
      return
    }

    // Find the city for each rounded location, one at a time (the server keeps the place service's pace).
    const cells = lookupCells(plan.withLocation)
    const places = {}
    setStep('finding'); setProgress({ done: 0, total: cells.length })
    let stopped = null
    for (const [i, cell] of cells.entries()) {
      if (stopped) break
      let answer = await placeSearch({ mode: 'reverse', lat: cell.lat, lon: cell.lon })
      if (answer?.message === foodPhotoErrorMessage('busy')) {
        await new Promise(r => setTimeout(r, 2000))
        answer = await placeSearch({ mode: 'reverse', lat: cell.lat, lon: cell.lon })
      }
      if (answer?.message) { places[cell.key] = undefined; if (answer.message === foodPhotoErrorMessage('too_many')) stopped = answer.message }
      else places[cell.key] = answer?.place ?? null
      setProgress({ done: i + 1, total: cells.length })
    }
    if (stopped) toast.error(stopped)

    const items = ready.map((item) => {
      const key = item.exif.gps ? cellKey(item.exif.gps) : null
      const place = key ? places[key] ?? null : null
      return {
        ...item,
        id: crypto.randomUUID(),
        place,
        fromPhoto: Boolean(place),
        lookupFailed: Boolean(key && !place),
        previewUrl: (() => { const u = URL.createObjectURL(new Blob([item.bytes])); previews.current.push(u); return u })(),
      }
    })
    setBatch({ items, unreadable: plan.unreadable.length, overLimit: plan.overLimit, visibility })
    setStep('review')
  }

  function setPlace(id, place) {
    setBatch(b => ({ ...b, items: b.items.map(i => (i.id === id ? { ...i, place } : i)) }))
  }
  function placeForAllWithout(place) {
    setBatch(b => ({ ...b, items: b.items.map(i => (!i.fromPhoto && !i.place ? { ...i, place } : i)) }))
  }

  function cancel() { setBatch(null); setStep('idle'); freePreviews() }

  async function addAll() {
    const items = batch.items
    setStep('adding'); setProgress({ done: 0, total: items.length })
    let next = 0, done = 0, added = 0
    const failures = {}
    let limitHit = false
    async function worker() {
      while (next < items.length && !limitHit) {
        const item = items[next++]
        let message
        try {
          const { full, thumb } = await shrinkPhoto(item.bytes)
          const paths = foodPhotoPaths(me, crypto.randomUUID())
          const args = addPhotoArgs({ paths, place: item.place, takenOn: item.exif.takenOn, visibility: batch.visibility })
          const result = await addFoodPhoto({ paths, full, thumb, args })
          message = result.message
          if (result.code && /photo_limit/.test(result.code)) limitHit = true
        } catch (err) {
          message = foodPhotoErrorMessage(err?.message)
        }
        if (message) failures[message] = (failures[message] ?? 0) + 1
        else added++
        setProgress({ done: ++done, total: items.length })
      }
    }
    await Promise.all(Array.from({ length: Math.min(WORKERS, items.length) }, worker))
    setBatch(null); setStep('idle'); freePreviews()
    await reload()
    if (added) toast.success(`Added ${plural(added, 'photo')}.`)
    for (const [message, n] of Object.entries(failures)) toast.error(`${plural(n, 'photo')} not added: ${message}`)
  }

  const withPlace = batch?.items.filter(i => i.fromPhoto) ?? []
  const withoutPlace = batch?.items.filter(i => !i.fromPhoto) ?? []
  const byCity = Object.entries(withPlace.reduce((m, i) => ({ ...m, [i.place.label]: (m[i.place.label] ?? 0) + 1 }), {}))
  const pinned = batch?.items.filter(i => i.place).length ?? 0

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-[28px]">Food photos{photos.length ? ` · ${photos.length}` : ''}</CardTitle>
        {step === 'idle' && (
          <Button type="button" onClick={() => inputRef.current?.click()} className="h-10 rounded-full px-4 font-semibold">
            <Camera className="h-4 w-4" /> Add photos
          </Button>
        )}
        <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,.zip,application/zip" className="hidden" onChange={choose} />
      </CardHeader>
      <CardContent className="space-y-4">
        {(step === 'reading' || step === 'finding' || step === 'adding') && (
          <p className="flex items-center gap-2 rounded-[14px] bg-muted px-3 py-3 text-sm" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            {step === 'reading' && 'Reading photos on this device…'}
            {step === 'finding' && `Finding places… ${progress.done} of ${progress.total}`}
            {step === 'adding' && `Adding photos… ${progress.done} of ${progress.total}`}
          </p>
        )}

        {step === 'review' && batch && (
          <div className="space-y-4 rounded-[14px] border border-input p-4">
            <div className="space-y-1 text-sm">
              <p className="font-semibold">{plural(batch.items.length, 'photo')} to add: {pinned} with a place, {batch.items.length - pinned} without.</p>
              {batch.unreadable > 0 && <p className="text-muted-foreground">{plural(batch.unreadable, 'file')} couldn&apos;t be read and will be left out.</p>}
              {batch.overLimit > 0 && <p className="text-muted-foreground">{plural(batch.overLimit, 'photo')} left out: you can keep {FOOD_PHOTO_LIMIT}.</p>}
              <p className="text-muted-foreground">
                Visible to: <span className="font-medium text-foreground">{batch.visibility === 'only_me' ? 'only you' : 'your friends'}</span>{' '}
                (<Link to="/settings" className="underline">change in Settings</Link>)
              </p>
            </div>

            {byCity.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">Places from the photos (nearest city)</p>
                <ul className="flex flex-wrap gap-2">
                  {byCity.map(([label, n]) => (
                    <li key={label} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-[13px]">
                      <MapPin className="h-3 w-3" aria-hidden="true" />{label} · {n}
                    </li>
                  ))}
                </ul>
                <Attribution />
              </div>
            )}

            {withoutPlace.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">Without a place · {withoutPlace.length}</p>
                <p className="text-[13px] text-muted-foreground">Add a place to put a photo on the map, or add it without one; you can add a place later.</p>
                {withoutPlace.length > 1 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer font-semibold text-primary-text">Same place for all of them</summary>
                    <div className="mt-2"><PlacePicker autoFocus={false} onPick={placeForAllWithout} /></div>
                  </details>
                )}
                <ul className="divide-y divide-border">
                  {withoutPlace.map(item => <NoPlaceRow key={item.id} item={item} onSetPlace={(p) => setPlace(item.id, p)} />)}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={addAll} className="h-10 rounded-full px-5 font-semibold">
                <Check className="h-4 w-4" /> Add {plural(batch.items.length, 'photo')}
              </Button>
              <Button type="button" variant="outline" onClick={cancel} className="h-10 rounded-full px-4">
                <X className="h-4 w-4" /> Cancel
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : photos.length === 0 ? (
          step === 'idle' && (
            <div className="rounded-[14px] border border-dashed border-input px-4 py-6 text-center text-sm text-muted-foreground">
              <p>Add photos of food you&apos;ve eaten. Your friends see them unless you choose otherwise in Settings.</p>
              <p className="mt-2">From Google Photos: put them in an album, choose <span className="font-medium">Download all</span>, then add the ZIP here.</p>
            </div>
          )
        ) : (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {photos.map(p => (
              <PhotoTile key={p.id} photo={p} groupName={groupNames[p.group_id]} onOpen={setEditing} onDelete={async (photo) => {
                const { message } = await remove(photo)
                if (message) { toast.error(message); return false }
                return true
              }} />
            ))}
          </ul>
        )}
        <FoodPhotoEditSheet
          photo={editing}
          groups={groups}
          onClose={() => setEditing(null)}
          onSave={async (photo, changes) => {
            const { message } = await update(photo, changes)
            if (message) { toast.error(message); return false }
            return true
          }}
        />
      </CardContent>
    </Card>
  )
}
