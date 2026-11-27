import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { foodPhotoErrorMessage, updatePhotoArgs } from '@/lib/foodPhotoUpload'

const BUCKET = 'food-photos'

// Food photos (docs/adr/0012, F1d/F1e): my photos with signed thumbnail links, my default
// visibility (Settings), place search through the place-search Edge Function, change and delete.
// Adding is done by FoodPhotosCard (it needs the browser-only shrinking).
export function useFoodPhotos() {
  const { session } = useAuth()
  const me = session?.user?.id
  const [photos, setPhotos] = useState([]) // rows + thumbUrl
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!me) return
    const { data, error: e } = await supabase.from('food_photos')
      .select('id, photo_path, thumb_path, place_name, lat, lon, precision, taken_on, visibility, group_id, created_at')
      .eq('owner_id', me).order('created_at', { ascending: false })
    if (e) { setError(e.message); setLoading(false); return }
    const rows = data ?? []
    let urls = {}
    if (rows.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(rows.map(r => r.thumb_path), 3600)
      urls = Object.fromEntries((signed ?? []).filter(s => s.signedUrl).map(s => [s.path, s.signedUrl]))
    }
    setPhotos(rows.map(r => ({ ...r, thumbUrl: urls[r.thumb_path] ?? null })))
    setError(null)
    setLoading(false)
  }, [me])

  useEffect(() => { load() }, [load])

  // Deletes the row first (nobody can see the files after that), then both files.
  const remove = useCallback(async (photo) => {
    const { error: e } = await supabase.from('food_photos').delete().eq('id', photo.id)
    if (e) return { message: foodPhotoErrorMessage(e.message) }
    const { error: fileError } = await supabase.storage.from(BUCKET).remove([photo.photo_path, photo.thumb_path])
    if (fileError) console.warn('food photo files not removed', fileError.message)
    setPhotos(list => list.filter(p => p.id !== photo.id))
    return {}
  }, [])

  // Changes a photo's place and/or who can see it (update_food_photo), then reloads.
  const update = useCallback(async (photo, changes) => {
    const { error: e } = await supabase.rpc('update_food_photo', updatePhotoArgs(photo, changes))
    if (e) return { message: foodPhotoErrorMessage(e.message) }
    await load()
    return {}
  }, [load])

  return { me, photos, loading, error, reload: load, remove, update }
}

/** A signed link to a photo file (1 hour), or null. */
export async function foodPhotoUrl(path) {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

/** { mode: 'reverse', lat, lon } or { mode: 'search', q } → the function's answer, or { message }. */
export async function placeSearch(body) {
  const { data, error } = await supabase.functions.invoke('place-search', { body })
  if (!error) return data
  let code = ''
  try { code = (await error.context?.json?.())?.error ?? '' } catch { /* not JSON */ }
  return { message: foodPhotoErrorMessage(code) }
}

export async function getFoodPhotoDefault() {
  const { data, error } = await supabase.rpc('food_photo_default')
  return error ? 'friends' : (data ?? 'friends')
}

export async function setFoodPhotoDefault(visibility, applyExisting) {
  const { data, error } = await supabase.rpc('set_food_photo_default', { p_visibility: visibility, p_apply_existing: applyExisting })
  return error ? { message: foodPhotoErrorMessage(error.message) } : { changed: data ?? 0 }
}

/** Uploads the two shrunk files, then the row; removes the files again if the row is refused. */
export async function addFoodPhoto({ paths, full, thumb, args }) {
  const bucket = supabase.storage.from(BUCKET)
  const up1 = await bucket.upload(paths.photo, full, { contentType: 'image/jpeg', upsert: false })
  if (up1.error) return { message: foodPhotoErrorMessage(up1.error.message) }
  const up2 = await bucket.upload(paths.thumb, thumb, { contentType: 'image/jpeg', upsert: false })
  if (up2.error) { await bucket.remove([paths.photo]); return { message: foodPhotoErrorMessage(up2.error.message) } }
  const { data, error } = await supabase.rpc('add_food_photo', args)
  if (error) { await bucket.remove([paths.photo, paths.thumb]); return { message: foodPhotoErrorMessage(error.message), code: error.message } }
  return { id: data }
}
