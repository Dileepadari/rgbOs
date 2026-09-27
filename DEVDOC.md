# Developer guide

How to run this, how it's put together, and the things that will bite you.

---

## 1. Requirements

| | Version | Notes |
| --- | --- | --- |
| Node.js | 20+ (developed on 22) | |
| npm | 10+ | `package-lock.json` is committed - use npm, not pnpm/yarn |
| PostgreSQL client | any | `psql`, only for running migrations |
| Supabase project | - | Postgres + Auth + Storage |
| ThingSpeak channel | - | One per device. Free tier is fine - it only carries a number |
| PlatformIO | 6+ | Only if you're building the firmware |

Firmware also needs an ESP32 (a plain WROOM is enough) and HUB75 panels with
their own 5V supply. Panels draw amps - USB power will not do it.

## 2. Environment

Create `.env` in the repo root:

```bash
# Supabase - project settings → API
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>

# Direct Postgres connection, for running migrations with psql.
# Supabase → project settings → database → connection string (session mode).
SUPABASE_POSTGRES_URL_NON_POOLING=postgres://...

# Shared secret for the heartbeat cron. Any long random string.
CRON_SECRET=<random string>

# ThingSpeak default, used when a device has no channel of its own.
THINGSPEAK_API_KEY=<write key>
```

`SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security. It is used only by
`/api/device-feed/[token]` (the device has no user session to authenticate
with) and the heartbeat cron. Never expose it to the browser - anything
prefixed `NEXT_PUBLIC_` is bundled into client JS.

## 3. Database

Run the migrations in order against your Supabase Postgres:

```bash
set -a && . ./.env && set +a
for f in scripts/0*.sql; do
  psql "$SUPABASE_POSTGRES_URL_NON_POOLING" -v ON_ERROR_STOP=1 -f "$f"
done
```

| Migration | What it adds |
| --- | --- |
| `001_create_tables.sql` | Core tables + row-level security |
| `002_device_automation.sql` | Device tokens, revisions, assignments |
| `003_cleanup_legacy_device_columns.sql` | Drops superseded columns |
| `004_scene_assets_bucket.sql` | Storage bucket for uploaded images |
| `005_activity_log.sql` | Activity feed |
| `006_mood_reactions.sql` | Mood reaction fields |

**Nothing applies migrations automatically.** Adding a `.sql` file does not run
it - on a fresh environment, or after pulling a change that adds one, run it
yourself. A missing migration shows up as a 500 from an API route.

RLS is on for every user-facing table and scoped to `auth.uid()`, so a user can
only ever read their own rows.

## 4. Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

Other scripts:

```bash
npm run build        # production build
npm run lint         # eslint
npx vitest run       # tests
npx tsc --noEmit     # type check
```

Firmware:

```bash
cd Arduino_code
pio run                      # compile
pio run --target upload      # flash
pio device monitor           # serial log, 115200 baud
```

Wiring (HUB75 connector, GPIO map, power) is in
[`Arduino_code/README.md`](Arduino_code/README.md).

Before flashing, copy `include/secrets.example.h` to `include/secrets.h` and
fill in WiFi, the backend URL, the device token, and the ThingSpeak keys. The
device token is the `device_api_token` column on that device's row. `secrets.h`
is gitignored - keep it that way.

## 5. How the code is organised

Read it in this order; each layer only depends on the ones above.

**`lib/scene-schema.ts` - start here.** Zod schemas defining what an element is.
This is the contract between the browser, the API, the database and the
firmware. `normalizeSceneElements()` is what you call when reading elements out
of the database: rows written before a field existed are repaired rather than
dropped, which is why old scenes still open.

**`lib/scene-compositor.ts`** - `tickAnimations()` advances animation phase,
`renderScene()` draws a frame. Every preview in the app goes through this, so
what you see is always one implementation, never a lookalike.

**`lib/character-sprites.ts`** - characters as layered ASCII grids (a body plus
face and limb patches), flattened at load. `Arduino_code/include/characters.h`
is **generated** from this file:

```bash
npx vite-node scripts/generate-characters-header.ts
```

Never hand-edit that header. `scripts/characters-header.test.ts` fails if it's
stale.

**`lib/mood-reaction.ts`** - the mood lifecycle (entrance → hold → stay/leave)
as pure functions. `Arduino_code/src/mood.cpp` mirrors it.

**`lib/panel-layouts.ts`**, **`lib/timezones.ts`** - wall arrangements, and
timezones as POSIX TZ strings (see §7).

**`app/api/`** - every mutating route validates its body with a Zod schema and
never spreads a raw request into a database update. Keep it that way.

**`components/`** - the `*-complete.tsx` files are the live pages;
`app/page.tsx` is the router. `components/ui/` is shadcn primitives.

## 6. Keeping the firmware and website in step

The same feature set is implemented twice, in TypeScript and C++. Drift is
silent and only appears on real hardware. Two tests guard it:

- `scripts/characters-header.test.ts` - the sprite header matches its source.
- `scripts/firmware-parity.test.ts` - reads the firmware sources and fails if
  the website can produce something the panel can't render: a new element type,
  animation, character, emote, mood entrance, a capacity mismatch, or a feed
  field the firmware doesn't parse.

**Adding a feature that touches both sides:** update the Zod schema, the
compositor, the firmware parser and renderer, then run `npx vitest run`. If the
parity test doesn't fail when you deliberately skip the firmware half, the test
is wrong - fix it.

Capacities must agree: `MAX_ELEMENTS` (12) and `MAX_PLAYLIST_ITEMS` (12) in
`Arduino_code/include/elements.h` are mirrored by the schemas. The firmware
holds a playlist in RAM so it can rotate without re-fetching; that's the bound.

## 7. Things that will bite you

**Timezones are POSIX strings, not IANA names.** The ESP32 has no tzdata and
cannot resolve `Asia/Kolkata`. The picker stores `IST-5:30`; the feed translates
legacy IANA values at the boundary (`toPosixTimezone()`). Get this wrong and the
clock is silently hours out.

**A scene's size must match the wall.** Panel arrangement is a *compile-time*
constant in the firmware (`include/panel_config.h`) because the display driver
needs it before any network traffic. The web app's copy is for previews and
cropping. Rearranging panels means reflashing.

**Brightness and timezone travel with the content**, so changing them needs a
push but not a reflash.

**Animation speed 0 means nothing moves.** A scrolling element at speed 0 parks
itself off-screen and never returns.

**The device clock starts on arrival.** Mood lifecycles are timed from when the
device applies the feed, not the server's timestamp - the two have no shared
clock.

## 8. Deployment

Vercel, with the environment variables from §2 set in project settings.

### The heartbeat needs an external scheduler

`/api/cron/heartbeat` polls each device's ThingSpeak channel and updates
`devices.is_online` / `last_sync`. It is **not** registered as a Vercel Cron -
the free plan's cron allowance is small and better spent elsewhere - so nothing
calls it automatically. Until something does, devices stay showing whatever
status they last had.

Point any external scheduler at it (cron-job.org, GitHub Actions, an existing
box with crontab). It authenticates with `CRON_SECRET` as a bearer token:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
     https://<your-deployment>/api/cron/heartbeat
```

Every 5 minutes matches the endpoint's own 5-minute offline threshold. Without
the header it returns 401.

## 9. Extras

`Arduino_code/extra_code/` holds things that are *not* part of the build:
`main_backup.cpp` (the pre-rewrite firmware, kept as reference - it will not
compile against current headers), `converter.py` (turns an image into the raw
format the panel streams; the web app does this in-browser at upload time), and
a sample `.raw` fixture.

`app/sprite-sheet/` is a dev page rendering every character × emote at panel
scale - the practical way to review sprite changes.

## 10. What this pass changed, and why it matters

**The MQTT publisher leaked a client per publish during an outage.** `ensureClient()`
built a client with `reconnectPeriod: 1000`, so mqtt.js retried on its own; the
`close` handler then ran a second, hand-rolled backoff and set `client = null`
without calling `end()`. The reference went, the object did not: it kept retrying
once a second for the life of the process, and the next publish stacked another
on top. Measured with no broker listening, counting the module's own
"connection closed" lines:

```
after 1 publish :  6 closes in 4s
after 2 publishes: 15 closes in 4s
after 3 publishes: 22 closes in 4s
```

The hand-rolled counter capped at 10 and only reset on a successful connect, so
after ten failures the module's own reconnection was off permanently. There is
now one client, one reconnect mechanism (mqtt.js's), `end()` before replacement,
and a bounded queue that drops the oldest messages.

`__setClientFactory` is a test seam. The old test called the real client, opened
a TCP connection to localhost:1883, failed, and left timers running for the rest
of the suite - while asserting only that the return value was a boolean.

**`/api/mqtt/publish` trusted the device id.** It checked that you were signed
in and then put `deviceId` straight into `devices/<id>/command`. It never asked
the database whose device that was, so any authenticated user could command any
device. The `devices` table has RLS keyed on `user_id`; nothing was querying it.
The route now looks the device up as the caller, so another user's device simply
is not there, and the id is constrained to characters that cannot escape the
topic (`/`, `+` and `#` are separators and wildcards).

**An unconfigured deployment returned 500 for everything.** `proxy.ts` read the
Supabase env vars with `!`, so `createServerClient` threw inside middleware and
every request, static pages included, got a framework stack trace. It now
returns a 503 naming the missing variables for API routes and lets pages
through, so the UI can render and say what is wrong.

**`lib/supabase/middleware.ts` was dead.** It exported an `updateSession` that
nothing imported, duplicating the session gate in `proxy.ts` with *different*
behaviour. Two copies of an auth check, one of them unreachable, is a trap:
fixing a bug in one leaves the other wrong. Deleted.

**Five dependencies were pinned to `latest`.** `@supabase/supabase-js`, `mqtt`,
`recharts`, `swr` and `@vercel/analytics`. A fresh install could pull a breaking
major with no change to `package.json`, so two checkouts of the same commit
built different applications. All now carets at the versions that were actually
installed.

**`npm test` was bare `vitest`**, which is watch mode. In CI it would have hung
until cancelled. It is `vitest run` now, with `test:watch` for the interactive one.

**A critical Next RCE was outstanding.** GHSA-p293-qw3h-jr36 and
GHSA-2xp9-vwfh-vxw4, unauthenticated, plus criticals in vitest and highs in
postcss, sharp, js-yaml, nanoid and browserslist. All cleared; the audit job in
CI is there so the next one is noticed.

**`dev-server.log` was committed**, and `next dev` writes an `AGENTS.md` into
the working tree on every run that nothing was ignoring.
