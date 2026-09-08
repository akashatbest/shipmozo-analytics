import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext({})

// Supabase's refresh token has no fixed expiry, so a signed-in session
// otherwise lasts forever. Track our own login timestamp and force a
// sign-out once it's older than this, independent of activity.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const LOGIN_AT_KEY = 'session_login_at'
const CHECK_INTERVAL_MS = 5 * 60 * 1000

function isSessionExpired() {
  const loginAt = Number(localStorage.getItem(LOGIN_AT_KEY))
  return !loginAt || Date.now() - loginAt > SESSION_TTL_MS
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Restore existing session on mount, but reject it if our own 24h TTL
    // has elapsed (Supabase would otherwise auto-refresh it forever).
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session && isSessionExpired()) {
        await supabase.auth.signOut()
        localStorage.removeItem(LOGIN_AT_KEY)
        setUser(null)
      } else {
        setUser(session?.user ?? null)
      }
      setLoading(false)
    })

    // Keep in sync with Supabase auth state
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        localStorage.setItem(LOGIN_AT_KEY, String(Date.now()))
      }
      if (event === 'SIGNED_OUT') {
        localStorage.removeItem(LOGIN_AT_KEY)
      }
      setUser(session?.user ?? null)
    })

    // Catch a session aging past the TTL while the tab is left open
    const interval = setInterval(async () => {
      if (localStorage.getItem(LOGIN_AT_KEY) && isSessionExpired()) {
        await supabase.auth.signOut()
        localStorage.removeItem(LOGIN_AT_KEY)
      }
    }, CHECK_INTERVAL_MS)

    return () => {
      subscription.unsubscribe()
      clearInterval(interval)
    }
  }, [])

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  async function signOut() {
    await supabase.auth.signOut()
    localStorage.removeItem(LOGIN_AT_KEY)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
