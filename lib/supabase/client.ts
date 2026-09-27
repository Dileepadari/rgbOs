import { createBrowserClient } from "@supabase/ssr"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/**
 * Whether the app has a backend to talk to.
 *
 * These were read with `!`, so an unconfigured deployment threw
 * "Your project's URL and Key are required to create a Supabase client" from
 * inside middleware and every single request, including static pages, returned
 * a 500 with a framework stack trace. Checking first lets the UI say what is
 * actually wrong.
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

export function createClient() {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    )
  }
  return createBrowserClient(url!, anonKey!)
}
