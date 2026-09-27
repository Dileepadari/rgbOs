import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_QUEUE_LENGTH,
  __setClientFactory,
  brokerUrl,
  getMQTTStatus,
  publishToDevice,
  resetMQTT,
} from '../lib/supabase/mqtt-server'

/**
 * A stand-in for an mqtt.js client. The previous test called the real thing,
 * which opened a TCP connection to localhost:1883, failed, and left reconnect
 * timers running for the rest of the suite. It also asserted only that the
 * return value was a boolean and that the status object had a key, so it would
 * have passed against a publishToDevice that did nothing at all.
 */
class FakeClient extends EventEmitter {
  connected = false
  ended = false
  published: Array<{ topic: string; message: string }> = []
  publishError: Error | null = null

  publish(topic: string, message: string, cb?: (err?: Error) => void) {
    if (this.publishError) {
      cb?.(this.publishError)
      return this
    }
    this.published.push({ topic, message })
    cb?.()
    return this
  }

  end(_force?: boolean) {
    this.ended = true
    this.connected = false
    return this
  }

  connect() {
    this.connected = true
    this.emit('connect')
  }

  drop() {
    this.connected = false
    this.emit('close')
  }
}

let created: FakeClient[] = []

beforeEach(() => {
  created = []
  __setClientFactory(() => {
    const c = new FakeClient()
    created.push(c)
    return c as never
  })
  resetMQTT()
})

afterEach(() => {
  resetMQTT()
  __setClientFactory(null)
})

describe('brokerUrl', () => {
  it('defaults to localhost:1883', () => {
    expect(brokerUrl()).toBe('mqtt://localhost:1883')
  })

  it('uses the configured broker and port', () => {
    vi.stubEnv('MQTT_BROKER', 'mqtt://broker.example')
    vi.stubEnv('MQTT_PORT', '8883')
    expect(brokerUrl()).toBe('mqtt://broker.example:8883')
    vi.unstubAllEnvs()
  })
})

describe('publishToDevice', () => {
  it('publishes when connected', () => {
    // The first call builds the client and queues, because nothing is
    // connected yet; connect() then flushes that one.
    publishToDevice('devices/a/command', 'queued-first')
    created[0].connect()

    const ok = publishToDevice('devices/a/command', '{"on":true}')
    expect(ok).toBe(true)
    expect(created[0].published).toEqual([
      { topic: 'devices/a/command', message: 'queued-first' },
      { topic: 'devices/a/command', message: '{"on":true}' },
    ])
  })

  it('queues and reports failure when the broker is unavailable', () => {
    const ok = publishToDevice('devices/a/command', 'hello')
    expect(ok).toBe(false)
    expect(getMQTTStatus()).toMatchObject({ connected: false, queueLength: 1 })
    expect(created[0].published).toEqual([])
  })

  it('flushes the queue once the broker comes back', () => {
    publishToDevice('devices/a/command', 'one')
    publishToDevice('devices/a/command', 'two')
    expect(getMQTTStatus().queueLength).toBe(2)

    created[0].connect()

    expect(getMQTTStatus().queueLength).toBe(0)
    expect(created[0].published.map((p) => p.message)).toEqual(['one', 'two'])
  })

  it('re-queues a message the broker rejected', () => {
    publishToDevice('devices/a/command', 'x')
    const c = created[0]
    c.connect()
    c.publishError = new Error('not authorised')

    publishToDevice('devices/a/command', 'y')
    expect(getMQTTStatus().queueLength).toBe(1)
  })
})

describe('the outage behaviour the old version got wrong', () => {
  it('reuses one client instead of building another per publish', () => {
    // The old code nulled `client` on close without ending it, so every
    // publish during an outage left another client retrying once a second for
    // the life of the process.
    for (let i = 0; i < 10; i++) publishToDevice('devices/a/command', String(i))
    expect(created).toHaveLength(1)

    created[0].drop()
    publishToDevice('devices/a/command', 'after a drop')
    expect(created).toHaveLength(1)
  })

  it('ends the client on reset rather than abandoning it', () => {
    publishToDevice('devices/a/command', 'x')
    const c = created[0]
    resetMQTT()
    expect(c.ended).toBe(true)
    expect(c.listenerCount('close')).toBe(0)
  })

  it('caps the queue instead of growing without limit', () => {
    // An unbounded array fed by every failed publish is a memory leak with
    // extra steps.
    for (let i = 0; i < MAX_QUEUE_LENGTH + 50; i++) {
      publishToDevice('devices/a/command', `msg-${i}`)
    }
    const status = getMQTTStatus()
    expect(status.queueLength).toBe(MAX_QUEUE_LENGTH)
    expect(status.droppedFromQueue).toBe(50)
  })

  it('drops the oldest messages, keeping the most recent', () => {
    for (let i = 0; i < MAX_QUEUE_LENGTH + 3; i++) {
      publishToDevice('devices/a/command', `msg-${i}`)
    }
    created[0].connect()
    const sent = created[0].published.map((p) => p.message)
    expect(sent).toHaveLength(MAX_QUEUE_LENGTH)
    expect(sent[0]).toBe('msg-3')
    expect(sent.at(-1)).toBe(`msg-${MAX_QUEUE_LENGTH + 2}`)
  })

  it('does not throw when the client blows up', () => {
    publishToDevice('devices/a/command', 'x')
    const c = created[0]
    c.connect()
    c.publish = () => {
      throw new Error('socket gone')
    }
    expect(() => publishToDevice('devices/a/command', 'y')).not.toThrow()
    expect(getMQTTStatus().queueLength).toBe(1)
  })
})
