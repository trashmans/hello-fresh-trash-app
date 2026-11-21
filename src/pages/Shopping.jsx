import { useOutletContext } from 'react-router-dom'
import ShoppingListPanel from '@/components/ShoppingListPanel'

// Shopping tab: this week's recipes and the list built from them.
export default function Shopping() {
  const { shoppingList } = useOutletContext()

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-8 lg:px-6 lg:py-12">
      <div className="flex flex-col gap-2.5">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-secondary">Shared with your household</p>
        <h1 className="text-4xl sm:text-[52px] font-bold leading-[1.02] tracking-[-0.02em]">This week</h1>
      </div>
      <ShoppingListPanel shoppingList={shoppingList} />
    </div>
  )
}
