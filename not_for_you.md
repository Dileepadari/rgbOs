# Not for you

An honest list of reasons to close this tab.

**You do not have the hardware.** This is the control plane for a wall of HUB75 LED panels driven by an ESP32. Without a panel and a board, you get a scene editor that previews pixels in a browser and nothing to send them to. The Arduino sketch in `Arduino_code/` is half the project.

**You want it to work without Supabase.** Every device, scene, playlist and mood lives in Postgres behind Supabase auth, and row-level security is what keeps one account's devices away from another's. With nothing configured you get the sign-in screen and a 503 from the API; that is a legible failure, not a working app.

**You want a hosted service.** There is none. You run the Next app (Vercel or otherwise), you run or rent a Supabase project, and you run an MQTT broker the ESP32 can reach. Three moving parts before a single pixel lights.

**You want device auth to be strong.** A device feed is fetched with a per-device token in the URL (`/api/device-feed/<token>`), because an ESP32 cannot hold a Supabase session. Anyone with the token can read that device's content. Rotate it by rotating the device.

**You want guaranteed delivery of commands.** MQTT publishes are queued when the broker is down and flushed when it returns, but the queue is bounded and drops the oldest messages first. A command sent during a long outage may simply never arrive. The panel is designed around that: it caches its playlist and keeps running on its own.

**You want the web UI tested.** 257 tests cover the sprite data, the character header generation, firmware parity, timezones, mood reactions and the MQTT publisher. None of them render a component. The editor, the dashboard and the device manager are verified by using them.

**You want to change the character set casually.** The sprites are shared between the website and the firmware: `scripts/generate-characters-header.ts` emits the Arduino header, and `scripts/firmware-parity.test.ts` fails if the two drift. Adding a character means regenerating the header and reflashing.

**You are looking for a finished product.** There is a second branch, `ui-redesign-visual-overhaul`, one commit ahead of `main` and twenty-one behind. Parts of this have been rebuilt more than once.

**You want thorough input validation everywhere.** The MQTT publish route now checks device ownership and constrains the device id, because it used to do neither. The other API routes were not audited to the same depth in this pass.
