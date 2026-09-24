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

// Matches the profiles migration's own column defaults, so the app behaves
// identically whether the profile hasn't loaded yet or has genuinely never
// been changed from default.
const DEFAULT_UNIT_PREFS = { temperature_unit: 'F', volume_unit: 'us', mass_unit: 'us' }

async function fetchUnitPrefs(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('temperature_unit, volume_unit, mass_unit')
    .eq('id', userId)
    .single()
  return data ?? DEFAULT_UNIT_PREFS
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [authError, setAuthError] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminMode, setAdminMode] = useState(() => localStorage.getItem('adminMode') === 'true')
  const [unitPrefs, setUnitPrefs] = useState(DEFAULT_UNIT_PREFS)

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
        setUnitPrefs(await fetchUnitPrefs(session.user.id))
      }
      setSession(session ?? null)
    }).catch(() => {
      setSession(null)
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
          setUnitPrefs(await fetchUnitPrefs(session.user.id))
          setAuthError(null)
        }

        if (event === 'SIGNED_OUT') {
          setSession(null)
          setIsAdmin(false)
          setAdminMode(false)
          setUnitPrefs(DEFAULT_UNIT_PREFS)
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

  // Optimistically updates local state so the UI reflects the change
  // immediately, then persists it in the background — covered by the
  // existing "users can update own profile" RLS policy, no new one needed.
  // This is a display preference, not something the rest of the upload/
  // parsing flow depends on, so a failed save just gets logged rather than
  // surfaced or retried.
  function updateUnitPref(field, value) {
    if (!session?.user?.id) return
    setUnitPrefs(prev => ({ ...prev, [field]: value }))
    supabase
      .from('profiles')
      .update({ [field]: value })
      .eq('id', session.user.id)
      .then(({ error }) => {
        if (error) console.warn(`Failed to save ${field} preference:`, error)
      })
  }

  return (
    <AuthContext.Provider value={{ session, authError, signOut, isAdmin, adminMode, toggleAdminMode, unitPrefs, updateUnitPref }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
