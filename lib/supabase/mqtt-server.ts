import mqtt, { MqttClient } from 'mqtt'

type QueuedMessage = { topic: string; message: string; attempts: number }

/**
 * Server-side MQTT publisher.
 *
 * The important thing about this file is what it used to do. `ensureClient()`
 * built a client with `reconnectPeriod: 1000`, so mqtt.js reconnected on its
 * own; the `close` handler then ALSO ran a hand-rolled exponential backoff and
 * set `client = null` without ever calling `end()`. The reference was dropped,
 * the object was not: it kept retrying once a second for the life of the
 * process, and the next publish built another one on top of it.
 *
 * Measured against the old code with no broker listening, counting the module's
 * own "connection closed" lines:
 *
 *     after 1 publish :  6 closes in 4s
 *     after 2 publishes: 15 closes in 4s
 *     after 3 publishes: 22 closes in 4s
 *
 * The hand-rolled counter also capped at 10 and only reset on a successful
 * connect, so after ten failures the module's own reconnect was off for good.
 *
 * Now: one client, one reconnect mechanism (mqtt.js's), old clients ended
 * before being replaced, and a bounded queue.
 */

// Long enough not to hammer a broker that is down, short enough to recover
// quickly when it comes back.
const RECONNECT_PERIOD_MS = 5_000
const CONNECT_TIMEOUT_MS = 30_000

// The queue existed so a command sent during a blip is not lost. Without a cap
// it is a memory leak with extra steps: a broker down for an hour on a busy
// server grows it without limit. Oldest messages are dropped first, because a
// stale display command is worth less than a fresh one.
export const MAX_QUEUE_LENGTH = 500
const MAX_ATTEMPTS = 5

type ClientFactory = (url: string) => MqttClient

let client: MqttClient | null = null
let queue: QueuedMessage[] = []
let droppedFromQueue = 0
let connectFactory: ClientFactory = (url) =>
  mqtt.connect(url, { reconnectPeriod: RECONNECT_PERIOD_MS, connectTimeout: CONNECT_TIMEOUT_MS })

export function brokerUrl() {
  const broker = process.env.MQTT_BROKER || process.env.NEXT_PUBLIC_MQTT_BROKER || 'mqtt://localhost'
  const port = process.env.MQTT_PORT || process.env.NEXT_PUBLIC_MQTT_PORT || '1883'
  return `${broker}:${port}`
}

function attach(c: MqttClient) {
  c.on('connect', () => {
    console.log('[server-mqtt] connected')
    flushQueue()
  })
  c.on('error', (err) => {
    // mqtt.js reconnects by itself; this handler exists so an error does not
    // become an unhandled 'error' event and take the process down.
    console.error('[server-mqtt] error', err.message)
  })
  c.on('close', () => {
    console.log('[server-mqtt] connection closed')
  })
  c.on('offline', () => {
    console.log('[server-mqtt] offline')
  })
}

function ensureClient(): MqttClient {
  if (client) return client
  client = connectFactory(brokerUrl())
  attach(client)
  return client
}

function enqueue(msg: QueuedMessage) {
  queue.push(msg)
  while (queue.length > MAX_QUEUE_LENGTH) {
    queue.shift()
    droppedFromQueue++
  }
}

function flushQueue() {
  while (queue.length > 0 && client && client.connected) {
    const q = queue.shift()!
    try {
      client.publish(q.topic, q.message, (err) => {
        if (err) {
          console.error('[server-mqtt] publish error', err)
          q.attempts++
          if (q.attempts < MAX_ATTEMPTS) enqueue(q)
        }
      })
    } catch (err) {
      console.error('[server-mqtt] publish exception', err)
      q.attempts++
      if (q.attempts < MAX_ATTEMPTS) enqueue(q)
    }
  }
}

export function publishToDevice(topic: string, message: string): boolean {
  try {
    const c = ensureClient()

    if (!c.connected) {
      console.warn('[server-mqtt] client not connected, queuing')
      enqueue({ topic, message, attempts: 0 })
      return false
    }

    c.publish(topic, message, (err) => {
      if (err) {
        console.error('[server-mqtt] publish error', err)
        enqueue({ topic, message, attempts: 1 })
      }
    })
    return true
  } catch (err) {
    console.error('[server-mqtt] publish failed', err)
    enqueue({ topic, message, attempts: 1 })
    return false
  }
}

export function getMQTTStatus() {
  return {
    connected: !!client && !!client.connected,
    queueLength: queue.length,
    droppedFromQueue,
  }
}

/**
 * Ends the client and clears state. Exported for tests and for a graceful
 * shutdown; without it the old code simply abandoned clients.
 */
export function resetMQTT() {
  if (client) {
    client.removeAllListeners()
    client.end(true)
    client = null
  }
  queue = []
  droppedFromQueue = 0
}

/** Test seam: swap in a fake client so the suite does no real network I/O. */
export function __setClientFactory(factory: ClientFactory | null) {
  connectFactory =
    factory ??
    ((url: string) =>
      mqtt.connect(url, { reconnectPeriod: RECONNECT_PERIOD_MS, connectTimeout: CONNECT_TIMEOUT_MS }))
}
