import { type NextRequest, NextResponse } from "next/server"

interface ThingSpeakData {
  channel_id: string
  field1?: string
  field2?: string
  field3?: string
  field4?: string
  field5?: string
  field6?: string
  field7?: string
  field8?: string
}

// ThingSpeak identifies a channel by its write key, not by a parameter, so a
// numeric id is all this can ever be. Validated rather than interpolated
// blindly: on the GET below it lands in the request path just ahead of the
// server's real API key, so a value containing ? or / could reach a different
// ThingSpeak endpoint carrying that key.
const CHANNEL_ID = /^[0-9]+$/

export async function POST(request: NextRequest) {
  try {
    const body: ThingSpeakData = await request.json()
    const { channel_id } = body

    if (!channel_id || !CHANNEL_ID.test(String(channel_id))) {
      return NextResponse.json({ error: "Numeric channel ID required" }, { status: 400 })
    }

    // channel_id used to be required and then ignored. /update writes to
    // whichever channel the write key belongs to, so a caller naming a
    // different channel got {"success": true} while the data went to this
    // server's one. Checking it against the configured channel makes the
    // parameter mean what it looks like it means.
    const configuredChannel = process.env.NEXT_PUBLIC_THINGSPEAK_CHANNEL_ID
    if (configuredChannel && String(channel_id) !== configuredChannel) {
      return NextResponse.json(
        { error: "channel_id does not match the channel this server writes to" },
        { status: 403 },
      )
    }

    // Validate ThingSpeak API key from environment
    const thingSpeakApiKey = process.env.THINGSPEAK_API_KEY
    if (!thingSpeakApiKey) {
      return NextResponse.json({ error: "ThingSpeak API key not configured" }, { status: 500 })
    }

    // Prepare data for ThingSpeak
    const thingSpeakData = new URLSearchParams()
    thingSpeakData.append("api_key", thingSpeakApiKey)

    // Map fields
    for (let i = 1; i <= 8; i++) {
      const fieldKey = `field${i}` as keyof ThingSpeakData
      if (body[fieldKey]) {
        thingSpeakData.append(`field${i}`, String(body[fieldKey]))
      }
    }

    // Send to ThingSpeak
    const response = await fetch("https://api.thingspeak.com/update", {
      method: "POST",
      body: thingSpeakData,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    })

    if (!response.ok) {
      throw new Error(`ThingSpeak API error: ${response.statusText}`)
    }

    const result = await response.text()

    return NextResponse.json({
      success: true,
      entryId: result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("ThingSpeak sync error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sync failed" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const channelId = request.nextUrl.searchParams.get("channel_id")
    const thingSpeakApiKey = process.env.THINGSPEAK_API_KEY

    if (!channelId || !CHANNEL_ID.test(channelId)) {
      return NextResponse.json({ error: "Numeric channel ID required" }, { status: 400 })
    }
    if (!thingSpeakApiKey) {
      return NextResponse.json({ error: "ThingSpeak API key not configured" }, { status: 500 })
    }

    const url = new URL(`https://api.thingspeak.com/channels/${channelId}/feeds.json`)
    url.searchParams.set("api_key", thingSpeakApiKey)
    url.searchParams.set("results", "1")

    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`ThingSpeak API error: ${response.statusText}`)
    }

    const data = await response.json()

    return NextResponse.json({
      success: true,
      data: data.feeds?.[0] || null,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("ThingSpeak fetch error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Fetch failed" }, { status: 500 })
  }
}
