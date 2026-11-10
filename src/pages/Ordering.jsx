import AlbertHeijnCard from '@/components/AlbertHeijnCard'
import StaplesCard from '@/components/StaplesCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const COMING = [
  { title: "This week's preview", text: 'What would go to your AH list: recipe ingredients, staples that are due, and bonus stock-ups. Nothing is sent until you say so.' },
  { title: 'Send to AH', text: 'Adds the week to your AH shopping list. You still pick a time slot and pay in the AH app.' },
]

// Automated ordering tab: the Albert Heijn link and the household's staples
// (rollout phase 4). The rest of the weekly flow (phases 5–6) is listed so
// people know what's coming.
export default function Ordering() {
  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Automated ordering</h1>
        <p className="mt-1 text-sm text-muted-foreground">Turn this week's recipes and your staples into an Albert Heijn shopping list.</p>
      </div>
      <AlbertHeijnCard />
      <StaplesCard />
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
