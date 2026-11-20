import { Check, ShoppingBasket } from 'lucide-react'

// The "add to this week's list" button on cards and list rows: a basket in a
// circle, filled saffron once the recipe is in the list.
export default function WeekListButton({ inList, onClick, size = 'h-11 w-11', className = '' }) {
  return (
    <button
      type="button"
      aria-pressed={inList}
      aria-label={inList ? "Remove from this week's list" : "Add to this week's list"}
      title={inList ? "Remove from this week's list" : "Add to this week's list"}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`${size} shrink-0 rounded-full border flex items-center justify-center transition-colors ${
        inList
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-foreground hover:bg-accent'
      } ${className}`}
    >
      {inList ? <Check className="h-[18px] w-[18px]" aria-hidden="true" /> : <ShoppingBasket className="h-[18px] w-[18px]" aria-hidden="true" />}
    </button>
  )
}
