import { useEffect, useMemo, useState } from 'react'
import { Loader2, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import PlacePicker from '@/components/PlacePicker'
import { choiceFor, parseVisibilityChoice, visibilityChoices } from '@/lib/foodPhotoUpload'
import { foodPhotoUrl } from '@/hooks/useFoodPhotos'

// Changing one food photo (docs/adr/0012, F1e): its place (a city, an exact spot such as a
// restaurant, or none) and who can see it (friends, one of my groups, or only me).
// Nothing is saved until Save.
export default function FoodPhotoEditSheet({ photo, groups = [], onClose, onSave }) {
  const [url, setUrl] = useState(null)
  const [place, setPlace] = useState(undefined)   // undefined: unchanged; null: removed
  const [choice, setChoice] = useState(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const choices = useMemo(() => visibilityChoices(groups), [groups])

  useEffect(() => {
    setPlace(undefined); setPicking(false); setUrl(null)
    if (!photo) return
    setChoice(choiceFor(photo))
    let live = true
    foodPhotoUrl(photo.photo_path).then(u => { if (live) setUrl(u) })
    return () => { live = false }
  }, [photo])

  if (!photo) return null
  const shown = place === undefined
    ? (photo.place_name ? { label: photo.place_name, precision: photo.precision } : null)
    : place
  const changed = place !== undefined || choice !== choiceFor(photo)
  // Groups may still be loading: keep the photo's current group as a choice meanwhile.
  const options = choice && !choices.some(c => c.value === choice) ? [...choices, { value: choice, label: 'A group' }] : choices

  async function save() {
    setBusy(true)
    const { visibility, groupId } = parseVisibilityChoice(choice)
    const changes = { ...(place !== undefined ? { place } : {}), ...(choice !== choiceFor(photo) ? { visibility, groupId } : {}) }
    const ok = await onSave(photo, changes)
    setBusy(false)
    if (ok) { toast.success('Photo saved.'); onClose() }
  }

  return (
    <Sheet open={Boolean(photo)} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Food photo</SheetTitle>
          <SheetDescription>{photo.taken_on ? `Taken ${photo.taken_on}` : 'Date not known'}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          {url
            ? <img src={url} alt="" className="max-h-[50vh] w-full rounded-[14px] object-contain bg-muted" />
            : <div className="flex h-48 items-center justify-center rounded-[14px] bg-muted"><Loader2 className="h-5 w-5 animate-spin" /></div>}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Place</h3>
            {shown ? (
              <p className="flex items-start gap-2 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{shown.label} <span className="text-muted-foreground">· {shown.precision === 'exact' ? 'exact spot' : 'city'}</span></span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No place: this photo isn&apos;t on the map.</p>
            )}
            {picking ? (
              <PlacePicker onPick={(p) => { setPlace(p); setPicking(false) }} onCancel={() => setPicking(false)} />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setPicking(true)}>{shown ? 'Change place' : 'Add a place'}</Button>
                {shown && <Button type="button" size="sm" variant="ghost" onClick={() => setPlace(null)}>Remove place</Button>}
              </div>
            )}
            <p className="text-[12px] text-muted-foreground">Search for a city, or for a restaurant or other spot to pin it exactly.</p>
          </section>

          <section className="space-y-2">
            <label htmlFor="food-photo-visibility" className="text-sm font-semibold">Who can see it</label>
            <select
              id="food-photo-visibility"
              value={choice ?? 'friends'}
              onChange={(e) => setChoice(e.target.value)}
              className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm"
            >
              {options.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <p className="text-[12px] text-muted-foreground">A group photo is seen by that group&apos;s members, including people who aren&apos;t your friends.</p>
          </section>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={save} disabled={!changed || busy} className="h-10 rounded-full px-5 font-semibold">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </Button>
            <Button type="button" variant="outline" onClick={onClose} className="h-10 rounded-full px-4">Cancel</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
