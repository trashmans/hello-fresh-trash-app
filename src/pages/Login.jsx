import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default function Login() {
  const navigate = useNavigate()

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
            <CardDescription>Enter your details to access your recipes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input type="email" placeholder="Email" />
            <Input type="password" placeholder="Password" />
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button className="w-full" size="lg" onClick={() => navigate('/home')}>
              Sign in
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Authentication is not yet active — sign in will pass through without verification.
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
