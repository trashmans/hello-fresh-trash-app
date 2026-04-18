import { useRef, useState } from 'react'
import { FileUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

const MAX_SIZE_BYTES = 10 * 1024 * 1024

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9 \-_.]/g, '').trim() || null
}

export default function PDFUploader({ onUploadComplete }) {
  const { session } = useAuth()
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  function handleClick() {
    inputRef.current?.click()
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.type !== 'application/pdf') {
      toast.error('Only PDF files are allowed.')
      return
    }

    if (file.size > MAX_SIZE_BYTES) {
      toast.error('File must be 10 MB or smaller.')
      return
    }

    setUploading(true)

    try {
      const storagePath = `pending/${crypto.randomUUID()}.pdf`
      const sanitizedFilename = sanitizeFilename(file.name)
      if (!sanitizedFilename) {
        toast.error('Filename contains only unsupported characters. Please rename the file and try again.')
        setUploading(false)
        return
      }

      const { error: uploadError } = await supabase.storage
        .from('recipe-pdfs')
        .upload(storagePath, file, { contentType: 'application/pdf' })

      if (uploadError) throw uploadError

      const { error: insertError } = await supabase
        .from('recipes')
        .insert({
          uploaded_by: session.user.id,
          filename: sanitizedFilename,
          storage_path: storagePath,
          status: 'ready',
        })

      if (insertError) throw insertError

      toast.success('Recipe uploaded!')
      onUploadComplete?.()
    } catch (err) {
      toast.error(`Upload failed: ${err.message ?? 'unknown error'}`)
      console.error(err)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button onClick={handleClick} disabled={uploading} size="lg">
        {uploading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <FileUp className="h-4 w-4" />
            Upload Recipe PDF
          </>
        )}
      </Button>
    </div>
  )
}
