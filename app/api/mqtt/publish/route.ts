import { NextResponse } from 'next/server'
import { publishToDevice } from '@/lib/supabase/mqtt-server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

// deviceId goes straight into an MQTT topic, so its shape is constrained here.
// A plain z.string() allowed '/', '+' and '#', which are topic separators and
// wildcards: a crafted id could publish outside devices/<id>/command.
const publishSchema = z.object({
  deviceId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_:.-]+$/, 'deviceId may only contain letters, digits and _ : . -'),
  command: z.any(),
})

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const parsed = publishSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 })

    const { deviceId, command } = parsed.data

    // Being signed in was the only check here. deviceId came off the request
    // body and went straight into the topic, so any authenticated user could
    // command any device, including one belonging to somebody else. The
    // devices table has RLS keyed on user_id, but nothing was ever asking it.
    // This select runs as the caller, so another user's device simply is not
    // there.
    const { data: device, error } = await supabase
      .from('devices')
      .select('id')
      .eq('device_id', deviceId)
      .maybeSingle()

    if (error) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
    if (!device) return NextResponse.json({ error: 'device_not_found' }, { status: 404 })

    const topic = `devices/${deviceId}/command`
    const ok = publishToDevice(topic, JSON.stringify(command))
    if (!ok) return NextResponse.json({ error: 'publish_failed' }, { status: 503 })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
