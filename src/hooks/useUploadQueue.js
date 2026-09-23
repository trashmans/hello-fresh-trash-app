import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { computeContentHash } from '@/lib/pdfUtils'
import { renderPdfCoverBlob } from '@/lib/pdfCover'
import { extractStepImageBlobs } from '@/lib/pdfStepImages'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_BATCH_BYTES = 50 * 1024 * 1024
const MAX_FILE_COUNT = 10
const MAX_CONCURRENT = 3
const UPLOAD_LIMIT = 20

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9 \-_.]/g, '').trim() || null
}

async function validateAndPrepare(file) {
  if (file.type !== 'application/pdf') return { error: 'Only PDF files are allowed' }
  if (file.size > MAX_FILE_SIZE) return { error: 'File must be 10 MB or smaller' }

  const sanitizedName = sanitizeFilename(file.name)
  if (!sanitizedName) return { error: 'Filename contains only unsupported characters' }

  const arrayBuffer = await file.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)

  if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    return { error: 'Not a valid PDF file' }
  }

  const contentHash = await computeContentHash(arrayBuffer)
  return { sanitizedName, contentHash }
}

async function runConcurrent(fns, limit) {
  let i = 0
  async function next() {
    if (i >= fns.length) return
    const idx = i++
    await fns[idx]()
    await next()
  }
  await Promise.all(Array.from({ length: Math.min(limit, fns.length) }, next))
}

export function useUploadQueue({ onUploadComplete }) {
  const { session } = useAuth()
  const [queue, setQueue] = useState([])
  const [isRunning, setIsRunning] = useState(false)
  const [summary, setSummary] = useState(null)

  function updateItem(id, patch) {
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item))
  }

  async function uploadFile(item) {
    updateItem(item.id, { status: 'uploading' })
    try {
      const fileUuid = crypto.randomUUID()
      const storagePath = `recipes/${session.user.id}/${fileUuid}.pdf`
      const coverStoragePath = `covers/${session.user.id}/${fileUuid}.jpg`

      // Content hash duplicate check (client-side pre-check, UX only)
      const { data: existingByHash } = await supabase
        .from('recipes')
        .select('id, name, filename')
        .eq('content_hash', item.contentHash)
        .in('status', ['processing', 'ready'])
        .maybeSingle()

      if (existingByHash) {
        const label = existingByHash.name ?? existingByHash.filename
        updateItem(item.id, {
          status: 'failed',
          error: `Duplicate: "${label}" already exists`,
          duplicateId: existingByHash.id,
        })
        return false
      }

      // Upload PDF
      const { error: uploadError } = await supabase.storage
        .from('recipe-pdfs')
        .upload(storagePath, item.file, { contentType: 'application/pdf' })
      if (uploadError) throw uploadError

      // Best-effort cover thumbnail — rendered client-side from page 1 (see
      // src/lib/pdfCover.js). Never blocks or fails the upload.
      let coverPath = null
      try {
        const arrayBuffer = await item.file.arrayBuffer()
        const coverBlob = await renderPdfCoverBlob(arrayBuffer)
        if (coverBlob) {
          const { error: coverUploadError } = await supabase.storage
            .from('recipe-pdfs')
            .upload(coverStoragePath, coverBlob, { contentType: 'image/jpeg' })
          if (!coverUploadError) coverPath = coverStoragePath
        }
      } catch (coverErr) {
        console.warn('Cover generation/upload failed, continuing without a cover:', coverErr)
      }

      // Best-effort per-step photos — extracted client-side from the PDF's
      // steps page (see src/lib/pdfStepImages.js). Uploaded now, under the
      // same fileUuid as the PDF/cover; the rows linking them to a recipe
      // are inserted below, once the recipe itself exists. Never blocks or
      // fails the upload — and note this can't check the extracted photo
      // count against the recipe's step count yet, since parsing (which
      // produces that count) hasn't run yet at upload time. That check
      // happens at display time instead (see useRecipeStepImages.js).
      const stepImageUploads = []
      try {
        const arrayBuffer = await item.file.arrayBuffer()
        const stepBlobs = await extractStepImageBlobs(arrayBuffer)
        for (let index = 0; index < stepBlobs.length; index++) {
          const stepStoragePath = `steps/${session.user.id}/${fileUuid}/${index}.jpg`
          // eslint-disable-next-line no-await-in-loop
          const { error: stepUploadError } = await supabase.storage
            .from('recipe-pdfs')
            .upload(stepStoragePath, stepBlobs[index], { contentType: 'image/jpeg' })
          if (!stepUploadError) stepImageUploads.push({ step_index: index, storage_path: stepStoragePath })
        }
      } catch (stepErr) {
        console.warn('Step image generation/upload failed, continuing without step photos:', stepErr)
      }

      // Insert DB row — status pending, triggers parse-recipe via DB webhook
      const { data: insertedRecipe, error: insertError } = await supabase
        .from('recipes')
        .insert({
          uploaded_by: session.user.id,
          filename: item.sanitizedName,
          storage_path: storagePath,
          cover_path: coverPath,
          content_hash: item.contentHash,
          status: 'pending',
        })
        .select('id')
        .single()
      if (insertError) throw insertError

      // Link up any step photos now that the recipe row (and its id) exists.
      // Best-effort: the recipe upload itself has already succeeded at this
      // point, so a failure here shouldn't be reported as a failed upload.
      if (stepImageUploads.length > 0) {
        const { error: stepRowsError } = await supabase
          .from('recipe_step_images')
          .insert(stepImageUploads.map(({ step_index, storage_path }) => ({
            recipe_id: insertedRecipe.id,
            step_index,
            storage_path,
          })))
        if (stepRowsError) {
          console.warn('Saving step image rows failed, continuing without step photos:', stepRowsError)
        }
      }

      updateItem(item.id, { status: 'done' })
      return true
    } catch (err) {
      updateItem(item.id, { status: 'failed', error: err.message ?? 'Upload failed' })
      return false
    }
  }

  async function submit(files) {
    if (isRunning) return

    const fileArray = Array.from(files)
    const excess = Math.max(0, fileArray.length - MAX_FILE_COUNT)
    if (excess > 0) {
      toast.warning(`Only the first 10 files were queued. ${excess} file${excess > 1 ? 's were' : ' was'} ignored.`)
    }
    const capped = fileArray.slice(0, MAX_FILE_COUNT)

    const entries = await Promise.all(
      capped.map(async file => {
        const result = await validateAndPrepare(file)
        return {
          id: crypto.randomUUID(),
          file,
          filename: file.name,
          size: file.size,
          status: result.error ? 'failed' : 'pending',
          error: result.error ?? null,
          sanitizedName: result.sanitizedName ?? null,
          contentHash: result.contentHash ?? null,
        }
      })
    )

    const validEntries = entries.filter(e => e.status === 'pending')
    const totalBytes = validEntries.reduce((sum, e) => sum + e.size, 0)

    const initialQueue = totalBytes > MAX_BATCH_BYTES
      ? entries.map(e =>
          e.status === 'pending'
            ? { ...e, status: 'failed', error: 'Total batch exceeds 50 MB limit' }
            : e
        )
      : entries

    setQueue(initialQueue)
    setSummary(null)

    const uploadable = initialQueue.filter(e => e.status === 'pending')

    if (uploadable.length === 0) {
      setSummary({ uploaded: 0, failed: initialQueue.length })
      return
    }

    setIsRunning(true)
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const { count, error: countError } = await supabase
        .from('recipes')
        .select('*', { count: 'exact', head: true })
        .eq('uploaded_by', session.user.id)
        .gte('created_at', oneHourAgo)

      if (!countError && (count ?? 0) + uploadable.length > UPLOAD_LIMIT) {
        toast.error("You've reached the upload limit (20 per hour). Please try again later.")
        setQueue(prev => prev.map(item =>
          item.status === 'pending' ? { ...item, status: 'failed', error: 'Rate limit reached' } : item
        ))
        setSummary({ uploaded: 0, failed: initialQueue.length })
        return
      }

      const results = []
      await runConcurrent(
        uploadable.map(item => async () => {
          const success = await uploadFile(item)
          results.push(success)
        }),
        MAX_CONCURRENT
      )

      const uploaded = results.filter(Boolean).length
      const validationFailed = initialQueue.length - uploadable.length
      const uploadFailed = results.filter(r => !r).length
      setSummary({ uploaded, failed: validationFailed + uploadFailed })
      if (uploaded > 0) onUploadComplete?.()
    } finally {
      setIsRunning(false)
    }
  }

  function clearQueue() {
    setQueue([])
    setSummary(null)
  }

  return { queue, isRunning, summary, submit, clearQueue }
}
