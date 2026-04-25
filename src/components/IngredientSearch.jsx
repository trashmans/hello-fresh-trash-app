import { Search, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'

export default function IngredientSearchBar({ value, onChange, loading }) {
  return (
    <div className="relative">
      <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
        {loading
          ? <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
          : <Search className="h-4 w-4 text-muted-foreground" />
        }
      </div>
      <Input
        type="text"
        placeholder="Search by ingredient… e.g. chicken garlic lemon"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="pl-9"
      />
    </div>
  )
}
