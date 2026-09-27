import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export async function proxy(request: NextRequest) {
  // These were read with `!`. With either missing, createServerClient threw
  // here - in middleware, so every request, static pages included, returned a
  // 500 with a framework stack trace and no hint that configuration was the
  // problem. An API caller now gets a clear 503; a page is let through so the
  // UI can render and explain itself.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json(
        {
          error: 'not_configured',
          detail:
            'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. See README.md.',
        },
        { status: 503 },
      )
    }
    return NextResponse.next()
  }

  const requestHeaders = new Headers(request.headers)
  const res = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          res.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          res.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  // getUser() revalidates the session against the Supabase auth server,
  // unlike getSession() which only trusts the (spoofable) cookie value.
  const { data: { user } } = await supabase.auth.getUser()

  // Device-facing routes authenticate via their own per-device token, not a
  // Supabase user session (the ESP32 can't log in) - skip the session gate.
  // Cron routes authenticate via CRON_SECRET (checked in the route itself).
  const skipsSessionGate =
    request.nextUrl.pathname.startsWith('/api/device-feed/') ||
    request.nextUrl.pathname.startsWith('/api/cron/')

  // If API route and no authenticated user, return 401
  if (request.nextUrl.pathname.startsWith('/api/') && !skipsSessionGate && !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return res
}

export const config = {
  matcher: [
    // Exclude static files and images
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    // Include all API routes
    "/api/:path*"
  ],
}
