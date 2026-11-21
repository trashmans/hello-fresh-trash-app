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
    <div className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-8 lg:px-6 lg:py-12">
      <div className="flex max-w-[760px] flex-col gap-2.5">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-secondary">Albert Heijn</p>
        <h1 className="text-4xl sm:text-[52px] font-bold leading-[1.02] tracking-[-0.02em]">Automated ordering</h1>
        <p className="text-base text-muted-foreground">
          This week&apos;s recipes and your staples, turned into your AH shopping list. You review it here, send it,
          then pick a time slot and pay in the AH app.
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-7">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-7 empty:hidden">
          <WeekPreviewCard shoppingList={shoppingList} ingredientMappings={ingredientMappings} />
        </div>
        <aside className="flex min-w-0 flex-[1_1_340px] flex-col gap-7">
          <AlbertHeijnCard />
          <StaplesCard />
          <MappedIngredientsCard ingredientMappings={ingredientMappings} />
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-[22px]">Coming next</CardTitle>
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
        </aside>
      </div>
    </div>
  )
}
