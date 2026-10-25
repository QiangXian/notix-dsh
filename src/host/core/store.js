/**
 * Durable notification bookkeeping.
 *
 * Dedupe keys, error cooldowns, and the recent-notification history live in
 * the `notix` storage domain when the Host serves one. Reads are synchronous
 * from the in-memory mirror; writes are best-effort and never fail a
 * notification. Without storage the same API works in memory only.
 * @module notix-dsh/core/store
 */
import { z } from 'zod'

const HISTORY_LIMIT = 200
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000

const historyRecordSchema = z.object({
  id: z.string(),
  kind: z.string(),
  urgency: z.string(),
  title: z.string(),
  body: z.string(),
  sessionId: z.string(),
  sessionTitle: z.string().optional(),
  dedupeKey: z.string(),
  createdAt: z.number(),
  delivered: z.boolean(),
  channels: z.array(z.string()),
  error: z.string().optional(),
})

const dedupeRecordSchema = z.object({
  at: z.number(),
})

/** Notix storage-domain declaration (plain spec; `defineDomain` is unnecessary here). */
const notixDomain = {
  name: 'notix',
  version: 1,
  layout: 'per-record',
  tables: {
    history: { valueSchema: historyRecordSchema },
    dedupe: { valueSchema: dedupeRecordSchema },
  },
}

/** In-memory notification record store with optional durable backing. */
export class NotixStore {
  /**
   * @param ctx - plugin context (used to resolve the optional storage domain service).
   * @param logger - plugin logger.
   */
  constructor(ctx, logger) {
    this.ctx = ctx
    this.logger = logger
    this.domain = null
    /** @type {Map<string, number>} dedupe key → last notification time */
    this.dedupe = new Map()
    /** @type {Map<string, {count: number, until: number}>} cooldown bucket key → state */
    this.cooldowns = new Map()
    /** @type {Array<object>} newest-last notification records */
    this.records = []
  }

  /** Open the durable domain when the Host serves one; never throws. */
  async open() {
    const storageDomain = this.ctx.get('storageDomain')
    if (storageDomain === undefined || typeof storageDomain.open !== 'function') {
      this.logger?.info('notix: storageDomain unavailable; notification history stays in memory')
      return
    }
    try {
      this.domain = await storageDomain.open(notixDomain)
      const now = Date.now()
      for (const [key, value] of this.domain.table('dedupe').entries()) {
        if (now - value.at <= DEDUPE_TTL_MS) this.dedupe.set(key, value.at)
      }
      const records = [...this.domain.table('history').entries()]
        .map(([, value]) => value)
        .sort((left, right) => left.createdAt - right.createdAt)
      this.records = records.slice(-HISTORY_LIMIT)
    } catch (error) {
      this.logger?.warn(`notix: opening the storage domain failed; continuing in memory: ${String(error)}`)
      this.domain = null
    }
  }

  /** Close the durable domain, if any. */
  async close() {
    const domain = this.domain
    this.domain = null
    if (domain === null) return
    try {
      await domain.close()
    } catch (error) {
      this.logger?.warn(`notix: closing the storage domain failed: ${String(error)}`)
    }
  }

  /**
   * Whether `key` was notified within the last `ttlMs`.
   * @param key - dedupe key.
   * @param ttlMs - retention window.
   * @returns true when the key is still fresh.
   */
  isDuplicate(key, ttlMs = DEDUPE_TTL_MS) {
    const at = this.dedupe.get(key)
    if (at === undefined) return false
    if (Date.now() - at > ttlMs) {
      this.dedupe.delete(key)
      return false
    }
    return true
  }

  /** Remember that `key` produced a notification now. */
  remember(key) {
    const at = Date.now()
    this.dedupe.set(key, at)
    this.pruneDedupe()
    if (this.domain !== null) {
      this.domain.table('dedupe').put(key, { at }).catch((error) => {
        this.logger?.debug?.(`notix: persisting dedupe key failed: ${String(error)}`)
      })
    }
  }

  /**
   * Record one occurrence against a cooldown bucket.
   * @param key - bucket key (usually kind + session).
   * @param windowMs - cooldown window; `0` disables suppression.
   * @returns how many occurrences were suppressed by this call (0 when delivered).
   */
  hitCooldown(key, windowMs) {
    if (windowMs <= 0) return 0
    const now = Date.now()
    const bucket = this.cooldowns.get(key)
    if (bucket !== undefined && now < bucket.until) {
      bucket.count += 1
      return bucket.count
    }
    this.cooldowns.set(key, { count: 0, until: now + windowMs })
    return 0
  }

  /** How many occurrences were suppressed in the current bucket. */
  suppressed(key) {
    return this.cooldowns.get(key)?.count ?? 0
  }

  /**
   * Append one notification record, trimming the retained history.
   * @param record - full notification record.
   */
  record(record) {
    this.records.push(record)
    if (this.records.length > HISTORY_LIMIT) this.records.splice(0, this.records.length - HISTORY_LIMIT)
    if (this.domain !== null) {
      this.domain.table('history').put(record.id, record).catch((error) => {
        this.logger?.debug?.(`notix: persisting notification history failed: ${String(error)}`)
      })
    }
  }

  /**
   * Patch one retained record after delivery settles.
   * @param id - notification id.
   * @param patch - fields to merge over the stored record.
   */
  update(id, patch) {
    const record = this.records.find((candidate) => candidate.id === id)
    if (record === undefined) return
    Object.assign(record, patch)
    if (this.domain !== null) {
      this.domain.table('history').put(id, record).catch(() => {})
    }
  }

  /**
   * Recent notifications, newest first.
   * @param limit - maximum rows to return.
   * @returns copied records safe for callers to inspect.
   */
  history(limit = 20) {
    return this.records.slice(-limit).reverse().map((record) => ({ ...record }))
  }

  /** Drop dedupe keys older than the retention window. */
  pruneDedupe() {
    if (this.dedupe.size < 512) return
    const now = Date.now()
    for (const [key, at] of this.dedupe) if (now - at > DEDUPE_TTL_MS) this.dedupe.delete(key)
  }
}
