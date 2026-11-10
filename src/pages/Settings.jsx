import { Link } from 'react-router-dom'
import { ArrowLeft, Moon, Sun } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/useTheme'

function AppearanceCard() {
  const { theme, setTheme } = useTheme()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Appearance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div role="group" aria-label="Colour theme" className="inline-flex gap-1 rounded-lg border border-border p-1">
          <Button type="button" variant={theme === 'light' ? 'default' : 'ghost'} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
            <Sun className="h-4 w-4" /> Light
          </Button>
          <Button type="button" variant={theme === 'dark' ? 'default' : 'ghost'} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
            <Moon className="h-4 w-4" /> Dark
          </Button>
        </div>
        <p className="text-muted-foreground">Saved on this device only.</p>
      </CardContent>
    </Card>
  )
}

export default function Settings() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <Button variant="outline" asChild>
          <Link to="/recipes"><ArrowLeft className="h-4 w-4" /> Back to recipes</Link>
        </Button>
      </div>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <AppearanceCard />
      <p className="text-sm text-muted-foreground">
        Albert Heijn linking has moved to the <Link to="/ordering" className="underline">Automated ordering</Link> tab.
      </p>
    </div>
  )
}
