import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const PLANNED = [
  { title: 'Share recipes', text: 'Send a recipe to a friend or a group by link. It stays in your collection; they can save a copy to theirs.' },
  { title: 'Friends', text: 'People you share recipes with.' },
  { title: 'Groups', text: 'Share with several people at once, such as family or a lunch club.' },
]

// Social tab: placeholder until the sharing features are designed and built.
export default function Social() {
  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Social</h1>
        <p className="mt-1 text-sm text-muted-foreground">Share recipes with friends and groups.</p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-lg">Planned</CardTitle>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Coming soon</span>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm">
            {PLANNED.map(item => (
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
