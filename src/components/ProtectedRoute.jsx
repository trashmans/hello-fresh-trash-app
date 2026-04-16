import { Navigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

export default function ProtectedRoute({ children }) {
  const { session } = useAuth()

  if (session === undefined) return null
  if (!session) return <Navigate to="/" replace />
  return children
}
