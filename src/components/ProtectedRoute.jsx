import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

export default function ProtectedRoute({ children }) {
  const { session } = useAuth()

  if (session === undefined) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
  if (!session) return <Navigate to="/" replace />
  return children
}
