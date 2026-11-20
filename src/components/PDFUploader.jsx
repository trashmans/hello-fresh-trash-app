import { useRef } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUploadQueue } from '@/hooks/useUploadQueue'
import UploadQueue from '@/components/UploadQueue'

export default function PDFUploader({ onUploadComplete }) {
  const inputRef = useRef(null)
  const { queue, isRunning, summary, submit, clearQueue } = useUploadQueue({ onUploadComplete })

  function handleFileChange(e) {
    const files = e.target.files
    if (!files?.length) return
    submit(files)
    e.target.value = ''
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <Button
        onClick={() => inputRef.current?.click()}
        disabled={isRunning}
        variant="outline"
        aria-label={isRunning ? 'Uploading recipes' : 'Upload recipe PDFs'}
        className="h-11 shrink-0 rounded-full px-3 sm:px-[18px] font-semibold"
      >
        {isRunning ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="hidden sm:inline">Uploading…</span>
          </>
        ) : (
          <>
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Upload recipe</span>
          </>
        )}
      </Button>
      <UploadQueue
        queue={queue}
        summary={summary}
        isRunning={isRunning}
        onClear={clearQueue}
      />
    </div>
  )
}
