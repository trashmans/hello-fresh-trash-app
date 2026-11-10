import { Link, useOutletContext } from 'react-router-dom'
import ShoppingListPanel from '@/components/ShoppingListPanel'

// Shopping tab: the list built from the recipes picked on the Recipes tab.
export default function Shopping() {
  const { shoppingList } = useOutletContext()

  return (
    <div className="p-4 md:p-6 space-y-4">
      {shoppingList.selectedIds.length === 0 && (
        <p className="mx-auto max-w-2xl text-sm text-muted-foreground">
          Nothing on the list yet. Pick recipes with the cart button on the <Link to="/recipes" className="underline">Recipes</Link> tab.
        </p>
      )}
      <ShoppingListPanel shoppingList={shoppingList} />
    </div>
  )
}
