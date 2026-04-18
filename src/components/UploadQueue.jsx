import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function StatusIcon({ status }) {
  if (status === 'uploading') return <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0 mt-0.5" />
  if (status === 'done') return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
  if (status === 'failed') return <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
  return <Clock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
}

export default function UploadQueue({ queue, summary, isRunning, onClear }) {
  if (queue.length === 0) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 rounded-lg border border-border bg-card shadow-lg sm:left-auto sm:w-80">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <p className="text-sm font-semibold">
          {isRunning ? 'Uploading…' : 'Uploads'}
        </p>
        {!isRunning && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>

      <div className="p-4 space-y-3 max-h-72 overflow-y-auto">
        {queue.map(item => (
          <div key={item.id} className="flex items-start gap-3">
            <StatusIcon status={item.status} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.filename}</p>
              {item.error && (
                <p className="text-xs text-destructive mt-0.5">{item.error}</p>
              )}
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{formatBytes(item.size)}</span>
          </div>
        ))}
      </div>

      {summary && (
        <div className="px-4 py-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {summary.uploaded} uploaded{summary.failed > 0 ? `, ${summary.failed} failed` : ''}
          </p>
        </div>
      )}
    </div>
  )
}
