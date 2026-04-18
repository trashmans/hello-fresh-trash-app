import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const AuthContext = createContext(null)

async function checkAllowlist(email) {
  const { data } = await supabase
    .from('allowed_emails')
    .select('email')
    .eq('email', email)
    .single()
  return !!data
}

async function fetchIsAdmin(userId) {
  const { data } = await supabase
    .from('user_roles')
    .select('is_admin')
    .eq('user_id', userId)
    .single()
  return data?.is_admin ?? false
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [authError, setAuthError] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminMode, setAdminMode] = useState(() => localStorage.getItem('adminMode') === 'true')

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const allowed = await checkAllowlist(session.user.email)
        if (!allowed) {
          await supabase.auth.signOut()
          setSession(null)
          setAuthError('Your email is not on the access list. Contact the app owner to request access.')
          return
        }
        setIsAdmin(await fetchIsAdmin(session.user.id))
      }
      setSession(session ?? null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          const allowed = await checkAllowlist(session.user.email)
          if (!allowed) {
            await supabase.auth.signOut()
            setSession(null)
            setIsAdmin(false)
            setAdminMode(false)
            setAuthError('Your email is not on the access list. Contact the app owner to request access.')
            return
          }
          setIsAdmin(await fetchIsAdmin(session.user.id))
          setAuthError(null)
        }

        if (event === 'SIGNED_OUT') {
          setSession(null)
          setIsAdmin(false)
          setAdminMode(false)
          localStorage.removeItem('adminMode')
          return
        }

        setSession(session ?? null)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const signOut = () => supabase.auth.signOut()

  function toggleAdminMode() {
    if (!isAdmin) return
    setAdminMode(prev => {
      const next = !prev
      localStorage.setItem('adminMode', String(next))
      return next
    })
  }

  return (
    <AuthContext.Provider value={{ session, authError, signOut, isAdmin, adminMode, toggleAdminMode }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
