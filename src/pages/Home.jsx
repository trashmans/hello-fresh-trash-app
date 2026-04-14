import { FileUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/context/AuthContext'

export default function Home() {
  const { signOut } = useAuth()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <Link to="/home">
          <h1 className="text-lg font-semibold text-primary hover:opacity-80 transition-opacity">Hello Fresh Trash</h1>
        </Link>
        <Button variant="ghost" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h2 className="text-2xl font-bold">Your Recipes</h2>
          <p className="text-muted-foreground mt-1">Upload HelloFresh recipe cards to build your catalogue</p>
        </div>
        <Card className="flex flex-col items-center text-center py-16">
          <CardHeader>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <FileUp className="h-7 w-7 text-primary" />
            </div>
            <CardTitle>No recipes yet</CardTitle>
            <CardDescription>Upload your first HelloFresh recipe card to get started</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="lg">
              <FileUp className="h-4 w-4" />
              Upload Recipe PDF
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
