import { useEffect, useState } from 'react'
import { Lock, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getFoodPhotoDefault, setFoodPhotoDefault } from '@/hooks/useFoodPhotos'

// Settings: who sees the food photos you add (docs/adr/0012, F1d). Applies to new photos;
// after a change, an offer to change your existing photos too.
const OPTIONS = [
  { value: 'friends', label: 'Friends', icon: Users },
  { value: 'only_me', label: 'Only me', icon: Lock },
]

export default function FoodPhotoSettingsCard() {
  const [value, setValue] = useState(null)
  const [offer, setOffer] = useState(null) // the value just chosen, until answered
  const [busy, setBusy] = useState(false)

  useEffect(() => { getFoodPhotoDefault().then(setValue) }, [])

  async function choose(next) {
    if (next === value || busy) return
    setBusy(true)
    const { message } = await setFoodPhotoDefault(next, false)
    setBusy(false)
    if (message) { toast.error(message); return }
    setValue(next)
    setOffer(next)
  }

  async function applyToExisting() {
    setBusy(true)
    const { message, changed } = await setFoodPhotoDefault(offer, true)
    setBusy(false)
    setOffer(null)
    if (message) { toast.error(message); return }
    toast.success(changed ? `Changed ${changed} ${changed === 1 ? 'photo' : 'photos'}.` : 'No photos needed changing.')
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Food photos</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>Who can see the food photos you add:</p>
        <div role="group" aria-label="Who can see new food photos" className="inline-flex gap-1 rounded-lg border border-border p-1">
          {OPTIONS.map(({ value: v, label, icon: Icon }) => (
            <Button key={v} type="button" variant={value === v ? 'default' : 'ghost'} aria-pressed={value === v} disabled={value === null || busy} onClick={() => choose(v)}>
              <Icon className="h-4 w-4" /> {label}
            </Button>
          ))}
        </div>
        {offer ? (
          <div className="space-y-2 rounded-[14px] bg-muted p-3">
            <p>
              Saved for new photos. Also change the photos you already have?{' '}
              {offer === 'only_me' ? 'All of them, including ones shared with a group, will be visible only to you.' : 'Photos visible only to you will be visible to your friends; photos shared with a group stay with that group.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={applyToExisting}>Change existing photos</Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setOffer(null)}>Only new photos</Button>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">You can still change a single photo later. Friends who are removed or groups you leave lose access straight away.</p>
        )}
      </CardContent>
    </Card>
  )
}
