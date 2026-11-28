import { useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { placeSearch } from '@/hooks/useFoodPhotos'

// Place search for food photos (docs/adr/0012): results only when Search is pressed (no
// autocomplete), shown with Geoapify's and OpenStreetMap's credit (Geoapify free plan).

const OSM_URL = 'https://www.openstreetmap.org/copyright'
const GEOAPIFY_URL = 'https://www.geoapify.com/'

export function Attribution() {
  return (
    <p className="text-[12px] text-muted-foreground">
      Powered by{' '}
      <a href={GEOAPIFY_URL} target="_blank" rel="noreferrer" className="underline">Geoapify</a>
      {' · '}
      <a href={OSM_URL} target="_blank" rel="noreferrer" className="underline">© OpenStreetMap contributors</a>
    </p>
  )
}

// Search for a place by name; results only when Search is pressed (no autocomplete).
export default function PlacePicker({ onPick, onCancel, autoFocus = true }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState(null)
  const [message, setMessage] = useState(null)

  async function search(e) {
    e.preventDefault()
    const text = q.replace(/\s+/g, ' ').trim()
    if (text.length < 2) { setMessage('Type at least 2 characters.'); return }
    setBusy(true); setMessage(null)
    const answer = await placeSearch({ mode: 'search', q: text })
    setBusy(false)
    if (answer?.message) { setMessage(answer.message); return }
    setResults(answer?.places ?? [])
  }

  return (
    <div className="space-y-2 rounded-[14px] border border-input p-3">
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="City or restaurant, e.g. Bangkok" autoFocus={autoFocus} className="h-10 min-w-0 flex-[1_1_180px]" aria-label="Place" />
        <Button type="submit" disabled={busy} className="h-10 rounded-full px-4 font-semibold">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
        </Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel} className="h-10 rounded-full px-3">Cancel</Button>}
      </form>
      {message && <p className="text-sm text-destructive">{message}</p>}
      {results && (results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No places found. Try another name.</p>
      ) : (
        <ul className="space-y-1">
          {results.map((p) => (
            <li key={`${p.label}|${p.lat}|${p.lon}`}>
              <button type="button" onClick={() => onPick(p)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-muted">
                <span className="block text-sm font-semibold">{p.label}</span>
                <span className="block truncate text-[12px] text-muted-foreground">{p.precision === 'exact' ? 'Exact spot · ' : ''}{p.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      ))}
      {results && <Attribution />}
    </div>
  )
}

