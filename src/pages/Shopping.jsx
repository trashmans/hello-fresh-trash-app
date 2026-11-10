import { useOutletContext } from 'react-router-dom'
import ShoppingListPanel from '@/components/ShoppingListPanel'

// Shopping tab: this week's recipes and the list built from them.
export default function Shopping() {
  const { shoppingList } = useOutletContext()

  return (
    <div className="p-4 md:p-6">
      <h1 className="sr-only">Shopping</h1>
      <ShoppingListPanel shoppingList={shoppingList} />
    </div>
  )
}
