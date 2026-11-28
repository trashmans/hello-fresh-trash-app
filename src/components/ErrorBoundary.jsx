import { Component } from 'react'
import { isChunkLoadError } from '@/lib/appVersion'

// Catches an error while a page renders, so one broken page shows a message instead of
// the whole app going blank (React removes everything when nothing catches a render error).
// resetKey: when it changes (the page address), the page is tried again, so switching tabs
// recovers. The error is logged to the browser console with the page it happened on.
export default class ErrorBoundary extends Component {
  state = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error) {
    return { error }
  }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  componentDidCatch(error, info) {
    console.error(`[page error] ${window.location.pathname}`, error, info?.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const newVersion = isChunkLoadError(error)
    return (
      <div role="alert" className="mx-auto max-w-md space-y-3 p-8 text-center">
        <p className="text-base font-semibold">
          {newVersion ? 'A new version of the app is available.' : 'Something went wrong on this page.'}
        </p>
        <p className="text-sm text-muted-foreground">
          {newVersion ? 'Reload to open this page.' : 'Reload to try again, or open another tab.'}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
        >
          Reload
        </button>
        {!newVersion && (
          <details className="text-left text-[12px] text-muted-foreground">
            <summary className="cursor-pointer">Details for a bug report</summary>
            <p className="mt-1 break-words font-mono">{String(error?.message ?? error)}</p>
          </details>
        )}
      </div>
    )
  }
}
