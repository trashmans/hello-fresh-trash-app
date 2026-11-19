import { useState } from 'react'
import { Package } from 'lucide-react'
import { cn } from '@/lib/utils'

// A small AH product photo (the product cache's image_url, only https://static.ah.nl/…),
// or a plain placeholder when there is none or it fails to load. Loaded lazily and
// without a referrer, so AH's image server isn't told which page of the app asked.
export default function ProductThumb({ src, className }) {
  const [failed, setFailed] = useState(false)
  const box = cn('flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white', className)

  if (!src || failed) {
    return (
      <span className={cn(box, 'bg-muted text-muted-foreground')} aria-hidden="true">
        <Package className="h-4 w-4" />
      </span>
    )
  }
  return (
    <span className={box}>
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="h-full w-full object-contain"
        onError={() => setFailed(true)}
      />
    </span>
  )
}
