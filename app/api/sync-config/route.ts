import { NextResponse } from "next/server"

export async function GET() {
  try {
    // Sensitive values like API keys are kept server-side only
    return NextResponse.json({
      mqttBroker: process.env.NEXT_PUBLIC_MQTT_BROKER || "mqtt.example.com",
      mqttPort: Number.parseInt(process.env.NEXT_PUBLIC_MQTT_PORT || "8883"),
      syncInterval: Number.parseInt(process.env.NEXT_PUBLIC_SYNC_INTERVAL || "5000"),
      thingSpeakChannelId: process.env.NEXT_PUBLIC_THINGSPEAK_CHANNEL_ID || "",
      // API key is NOT returned to client
    })
  } catch (error) {
    console.error("Config fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch config" }, { status: 500 })
  }
}

// Not implemented, and it says so.
//
// This used to accept a body, pick three fields out of it, save nothing, and
// answer `{"success": true, "message": "Configuration updated"}`. A caller had
// no way to tell that its settings had gone nowhere. These values come from
// the environment (see GET above), so changing them is a redeploy, not an API
// call - until there is somewhere to persist them, 501 is the honest answer.
export async function POST() {
  return NextResponse.json(
    {
      error: "not_implemented",
      detail:
        "Sync configuration is read from the environment. Change NEXT_PUBLIC_MQTT_BROKER, " +
        "NEXT_PUBLIC_MQTT_PORT or NEXT_PUBLIC_SYNC_INTERVAL and redeploy.",
    },
    { status: 501 },
  )
}
