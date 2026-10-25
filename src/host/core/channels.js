/**
 * Channel registry: pluggable delivery adapters with bounded retries and a
 * per-channel circuit breaker. Delivery failures never escape to the agent.
 * @module notix-dsh/core/channels
 */

const RETRY_DELAYS_MS = [1000, 5000, 15000]
const DELIVERY_TIMEOUT_MS = 10_000
const BREAKER_FAILURES = 3
const BREAKER_COOLDOWN_MS = 5 * 60_000

/** Run `promise` with a timeout, resolving to its value or rejecting on expiry. */
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Adapter registry with enable/disable, retry, and breaker state. */
export class ChannelRegistry {
  /**
   * @param logger - plugin logger.
   */
  constructor(logger) {
    this.logger = logger
    /** @type {Map<string, {id: string, send: Function, enabled: boolean}>} */
    this.adapters = new Map()
    /** @type {Map<string, {failures: number, until: number}>} */
    this.breakers = new Map()
  }

  /**
   * Register a delivery adapter.
   * @param adapter - `{ id, send(notification) }`.
   * @returns disposer that unregisters the adapter.
   */
  register(adapter) {
    if (typeof adapter?.id !== 'string' || adapter.id === '') throw new TypeError('notix: channel adapter requires a non-empty id')
    if (typeof adapter.send !== 'function') throw new TypeError(`notix: channel "${adapter.id}" requires a send() method`)
    this.adapters.set(adapter.id, { id: adapter.id, send: adapter.send.bind(adapter), enabled: true })
    return () => {
      this.adapters.delete(adapter.id)
    }
  }

  /** Enable or disable one registered channel. */
  setEnabled(id, enabled) {
    const adapter = this.adapters.get(id)
    if (adapter !== undefined) adapter.enabled = enabled
  }

  /** Ids of every registered channel. */
  ids() {
    return [...this.adapters.keys()]
  }

  /**
   * Deliver one notification to every enabled channel, isolating failures.
   * @param notification - rendered notification.
   * @returns names of channels that accepted the notification.
   */
  async deliver(notification) {
    const delivered = []
    const enabled = [...this.adapters.values()].filter((adapter) => adapter.enabled)
    for (const adapter of enabled) {
      const breaker = this.breakers.get(adapter.id)
      if (breaker !== undefined && breaker.until > Date.now()) continue
      let lastError
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          await withTimeout(Promise.resolve(adapter.send(notification)), DELIVERY_TIMEOUT_MS, `notix channel "${adapter.id}"`)
          delivered.push(adapter.id)
          this.breakers.delete(adapter.id)
          lastError = undefined
          break
        } catch (error) {
          lastError = error
          const delay = RETRY_DELAYS_MS[attempt]
          if (delay === undefined) break
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
      if (lastError !== undefined) {
        const failures = (this.breakers.get(adapter.id)?.failures ?? 0) + 1
        this.breakers.set(adapter.id, {
          failures,
          until: failures >= BREAKER_FAILURES ? Date.now() + BREAKER_COOLDOWN_MS : 0,
        })
        this.logger?.warn(`notix: channel "${adapter.id}" failed: ${String(lastError)}`)
      }
    }
    return delivered
  }
}
