import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [authError, setAuthError] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          const { data } = await supabase
            .from('allowed_emails')
            .select('email')
            .eq('email', session.user.email)
            .single()

          if (!data) {
            await supabase.auth.signOut()
            setSession(null)
            setAuthError('Your email is not on the access list. Contact the app owner to request access.')
            return
          }

          setAuthError(null)
        }

        if (event === 'SIGNED_OUT') {
          setSession(null)
          return
        }

        setSession(session ?? null)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const signOut = () => supabase.auth.signOut()

  return (
    <AuthContext.Provider value={{ session, authError, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
