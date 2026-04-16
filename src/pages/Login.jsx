import { Navigate, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

export default function Login() {
  const { session, authError } = useAuth()

  if (session) return <Navigate to="/home" replace />

  const handleGoogleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground">Hello Fresh Trash</h1>
          <p className="text-muted-foreground mt-1">Your personal recipe catalogue</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Use your Google account to access your recipes</CardDescription>
          </CardHeader>
          <CardContent>
            {authError && (
              <p className="text-sm text-destructive">{authError}</p>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button className="w-full" size="lg" onClick={handleGoogleSignIn}>
              Sign in with Google
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              By signing in, you agree that we store your name and email from Google
              to attribute your uploads.{' '}
              <Link to="/privacy" className="underline">Privacy Policy</Link>.
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
