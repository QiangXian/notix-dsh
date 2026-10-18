/**
 * Notix core: the notification pipeline shared by every trigger.
 *
 * Pipeline: rule filter → dedupe → cooldown → quiet hours → render → queue →
 * channel delivery. Every step is failure-isolated and never throws into the
 * agent loop.
 * @module notix-dsh/core/notix
 */
import { randomUUID } from 'node:crypto'
import { NotixStore } from './store.js'
import { ChannelRegistry } from './channels.js'
import { renderNotification } from './render.js'
import { MacosChannel } from '../channels/macos.js'

/** Parse "HH:MM" into minutes since midnight; invalid input yields undefined. */
function parseClock(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim())
  if (match === null) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return undefined
  return hours * 60 + minutes
}

/** Current local time as minutes since midnight. */
function nowMinutes() {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

/** The notification pipeline. */
export class NotixCore {
  /**
   * @param ctx - plugin context.
   * @param config - resolved configuration.
   * @param logger - plugin logger.
   */
  constructor(ctx, config, logger) {
    this.ctx = ctx
    this.config = config
    this.logger = logger
    this.store = new NotixStore(ctx, logger)
    this.channels = new ChannelRegistry(logger)
    this.chain = Promise.resolve()
    /** @type {Map<string, number>} `${sessionId}:${turn}` → start time */
    this.turnStarts = new Map()
    /** @type {Map<string, {startedAt: number, label: string}>} jobId → facts */
    this.jobStarts = new Map()
    /** @type {Map<string, Set<string>>} sessionId → reasons the agent is blocked on the user */
    this.busy = new Map()
  }

  /**
   * Mark one session as blocked on human interaction.
   * @param sessionId - session id.
   * @param reason - e.g. 'approval' | 'question'.
   */
  markBusy(sessionId, reason) {
    let reasons = this.busy.get(sessionId)
    if (reasons === undefined) {
      reasons = new Set()
      this.busy.set(sessionId, reasons)
    }
    reasons.add(reason)
  }

  /**
   * Clear one blocking reason for a session.
   * @param sessionId - session id.
   * @param reason - the reason to clear.
   */
  clearBusy(sessionId, reason) {
    const reasons = this.busy.get(sessionId)
    if (reasons === undefined) return
    reasons.delete(reason)
    if (reasons.size === 0) this.busy.delete(sessionId)
  }

  /** Whether the agent of `sessionId` is currently waiting on the user. */
  isBusy(sessionId) {
    return this.busy.has(sessionId)
  }

  /** Open persistence and register configured built-in channels. */
  async start() {
    await this.store.open()
    if (this.config.channels.macos.enabled) {
      this.channels.register(new MacosChannel(this.config.channels.macos, this.logger))
    }
  }

  /** Release persistence (timers/listeners are owned by the plugin fiber). */
  async dispose() {
    await this.store.close()
  }

  /** Session title from the `title` projection when available. */
  sessionTitle(session) {
    try {
      const title = this.ctx.get('sessionProjections')?.stateOf(session, 'title')
      return typeof title === 'string' && title !== '' ? title : undefined
    } catch {
      return undefined
    }
  }

  /** Remember when a turn started. */
  beginTurn(session, turn) {
    this.turnStarts.set(`${session.header.id}:${turn}`, Date.now())
  }

  /**
   * Finish a turn and report its duration.
   * @returns duration in milliseconds, or 0 when the start was unknown.
   */
  endTurn(session, turn) {
    const key = `${session.header.id}:${turn}`
    const startedAt = this.turnStarts.get(key)
    this.turnStarts.delete(key)
    return startedAt === undefined ? 0 : Date.now() - startedAt
  }

  /** Remember when a background job started. */
  beginJob(jobId, label) {
    this.jobStarts.set(jobId, { startedAt: Date.now(), label })
  }

  /** Forget a finished background job. */
  endJob(jobId) {
    const facts = this.jobStarts.get(jobId)
    this.jobStarts.delete(jobId)
    return facts
  }

  /** Whether the current local time falls inside the configured quiet hours. */
  inQuietHours(urgency) {
    const quiet = this.config.quietHours
    if (!quiet?.enabled) return false
    if (urgency === 'urgent' && quiet.allowUrgent) return false
    const from = parseClock(quiet.from)
    const to = parseClock(quiet.to)
    if (from === undefined || to === undefined) return false
    const current = nowMinutes()
    if (from === to) return false
    return from < to ? current >= from && current < to : current >= from || current < to
  }

  /**
   * Feed one trigger through the pipeline. Safe to call fire-and-forget.
   * @param trigger - raw trigger facts.
   * @returns the settled notification, or undefined when suppressed.
   */
  async submit(trigger) {
    try {
      if (this.inQuietHours(trigger.urgency)) return undefined
      if (this.store.isDuplicate(trigger.dedupeKey)) return undefined
      this.store.remember(trigger.dedupeKey)

      if (trigger.kind === 'error') {
        const bucketKey = `error:${trigger.sessionId}`
        const suppressed = this.store.hitCooldown(bucketKey, this.config.triggers.error.cooldownMs)
        if (suppressed > 0) return undefined
        trigger.suppressedCount = this.store.suppressed(bucketKey)
      }

      const { title, body } = renderNotification(this.config, trigger)
      const record = {
        id: randomUUID(),
        kind: trigger.kind,
        urgency: trigger.urgency,
        title,
        body,
        sessionId: trigger.sessionId,
        ...(trigger.payload.sessionTitle === undefined ? {} : { sessionTitle: trigger.payload.sessionTitle }),
        dedupeKey: trigger.dedupeKey,
        createdAt: Date.now(),
        delivered: false,
        channels: [],
      }
      this.store.record(record)

      this.chain = this.chain
        .then(async () => {
          const channels = await this.channels.deliver({ ...record, kind: trigger.kind, payload: trigger.payload })
          this.store.update(record.id, { delivered: channels.length > 0, channels })
        })
        .catch((error) => {
          this.logger?.warn(`notix: delivery pipeline failed: ${String(error)}`)
        })
      return record
    } catch (error) {
      this.logger?.warn(`notix: trigger processing failed (${trigger?.kind ?? 'unknown'}): ${String(error)}`)
      return undefined
    }
  }

  /**
   * Deliver a manually composed notification from another plugin.
   * @param input - title/body plus optional metadata.
   */
  async notify(input) {
    const sessionId = input.sessionId ?? 'manual'
    return this.submit({
      kind: 'manual',
      sessionId,
      urgency: input.urgency ?? 'normal',
      dedupeKey: input.dedupeKey ?? `manual:${randomUUID()}`,
      payload: {
        title: input.title ?? 'Notix',
        body: input.body ?? '',
        sessionTitle: input.sessionTitle,
      },
    })
  }

  /** Public service face exposed as `ctx.notix`. */
  api() {
    return {
      notify: (input) => this.notify(input),
      registerChannel: (adapter) => this.channels.register(adapter),
      history: (limit) => this.store.history(limit),
      config: this.config,
    }
  }
}
