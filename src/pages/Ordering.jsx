import { useOutletContext } from 'react-router-dom'
import AlbertHeijnCard from '@/components/AlbertHeijnCard'
import StaplesCard from '@/components/StaplesCard'
import WeekPreviewCard from '@/components/WeekPreviewCard'
import MappedIngredientsCard from '@/components/MappedIngredientsCard'
import { useIngredientMappings } from '@/hooks/useIngredientMappings'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const COMING = [
  { title: 'Automatic weekly order', text: 'Optionally, the app prepares your AH list every week by itself and lets you know when it is ready. You still pick a time slot and pay in the AH app.' },
]

// Automated ordering tab: the Albert Heijn link, the household's staples and ingredient
// mappings (rollout phase 4), this week's preview (phase 5) and sending it to AH (phase 6,
// inside the preview card). The mappings are loaded here because the preview applies them
// and the list below manages them. The automatic weekly run (phase 7) is listed so people
// know what's coming.
export default function Ordering() {
  const { shoppingList } = useOutletContext()
  const ingredientMappings = useIngredientMappings()

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Automated ordering</h1>
        <p className="mt-1 text-sm text-muted-foreground">Turn this week's recipes and your staples into an Albert Heijn shopping list.</p>
      </div>
      <AlbertHeijnCard />
      <StaplesCard />
      <WeekPreviewCard shoppingList={shoppingList} ingredientMappings={ingredientMappings} />
      <MappedIngredientsCard ingredientMappings={ingredientMappings} />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-lg">Coming next</CardTitle>
            <span className="rounded-full bg-badge px-2.5 py-0.5 text-xs font-medium text-badge-foreground">In progress</span>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm">
            {COMING.map(item => (
              <li key={item.title}>
                <span className="font-medium">{item.title}.</span> <span className="text-muted-foreground">{item.text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
