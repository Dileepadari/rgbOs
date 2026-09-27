"use client"

import type React from "react"
import { createContext, useContext, useState, useEffect } from "react"
import type { User as SupabaseUser } from "@supabase/supabase-js"
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"

interface User {
  id: string
  email: string
  name: string
  createdAt: string
}

interface AuthContextType {
  user: User | null
  isLoggedIn: boolean
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, name: string) => Promise<{ needsEmailConfirmation: boolean }>
  logout: () => Promise<void>
  updateName: (name: string) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  signOutEverywhere: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function toUser(supabaseUser: SupabaseUser): User {
  return {
    id: supabaseUser.id,
    email: supabaseUser.email ?? "",
    name: (supabaseUser.user_metadata?.full_name as string | undefined) || supabaseUser.email?.split("@")[0] || "",
    createdAt: supabaseUser.created_at,
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  // With no backend configured there is nobody to be signed in as, and nothing
  // to wait for. Deriving the initial value rather than setting it inside the
  // effect avoids a synchronous setState there.
  const [loading, setLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    // Nothing to subscribe to without a backend; the app renders its auth
    // screen, which can say so, instead of the whole request 500ing.
    if (!isSupabaseConfigured) return

    const supabase = createClient()

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ? toUser(data.user) : null)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? toUser(session.user) : null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const login = async (email: string, password: string) => {
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
  }

  const signup = async (email: string, password: string, name: string) => {
    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters")
    }

    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    })
    if (error) throw new Error(error.message)

    if (data.user && !data.session) {
      return { needsEmailConfirmation: true }
    }
    return { needsEmailConfirmation: false }
  }

  const logout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    setUser(null)
  }

  const updateName = async (name: string) => {
    const supabase = createClient()
    const { data, error } = await supabase.auth.updateUser({ data: { full_name: name } })
    if (error) throw new Error(error.message)
    if (data.user) setUser(toUser(data.user))
  }

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (newPassword.length < 6) {
      throw new Error("New password must be at least 6 characters")
    }

    const supabase = createClient()
    const {
      data: { user: current },
    } = await supabase.auth.getUser()
    if (!current?.email) throw new Error("Not signed in")

    // updateUser() alone would let anyone holding a live session change the
    // password without proving they know the current one. Re-authenticating
    // first means a borrowed/stolen session can't lock the owner out.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: current.email,
      password: currentPassword,
    })
    if (reauthError) throw new Error("Current password is incorrect")

    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw new Error(error.message)
  }

  // Revokes every refresh token for this user, so other browsers/devices are
  // signed out too - not just this tab.
  const signOutEverywhere = async () => {
    const supabase = createClient()
    const { error } = await supabase.auth.signOut({ scope: "global" })
    if (error) throw new Error(error.message)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, isLoggedIn: !!user, loading, login, signup, logout, updateName, changePassword, signOutEverywhere }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
