/**
 * Test harness: a minimal Cordis-like context plus a controllable clock.
 * @module notix-dsh/test/mock
 */
import { NotixCore } from '../src/host/core/notix.js'
import { resolveConfig } from '../src/host/config.js'

/** Fake clock installed over `Date.now`. */
export function installClock(start = 1_700_000_000_000) {
  const realNow = Date.now
  let offset = 0
  Date.now = () => start + offset
  return {
    advance(ms) {
      offset += ms
    },
    restore() {
      Date.now = realNow
    },
  }
}

/** Create a fake session object. */
export function createSession(id, title) {
  return {
    header: { id },
    title,
  }
}

/**
 * Create a Cordis-like context for plugin tests.
 * @param options - `sessions`, `title`, `clock`.
 */
export function createMockContext(options = {}) {
  const listeners = new Map()
  const services = new Map()
  const timers = new Set()
  const logs = []
  const sessions = options.sessions ?? []
  const titles = new Map(options.title ?? [])
  const questionState = new Map()
  const clock = options.clock ?? installClock()
  let projectionListener

  const logger = {
    info: (message) => logs.push(['info', message]),
    warn: (message) => logs.push(['warn', message]),
    debug: (message) => logs.push(['debug', message]),
  }

  const sessionProjections = {
    stateOf(session, key) {
      if (key === 'title') return titles.get(session.header.id) ?? null
      if (key === 'userQuestions') return questionState.get(session.header.id) ?? { active: [], settled: [] }
      return undefined
    },
    onChanged(listener) {
      projectionListener = listener
      return () => {
        projectionListener = undefined
      }
    },
  }
  services.set('sessionProjections', sessionProjections)

  /** Run every timer due at the current fake time. */
  const runDueTimers = () => {
    let guard = 0
    for (;;) {
      const due = [...timers].filter((timer) => !timer.cancelled && timer.due <= Date.now()).sort((a, b) => a.due - b.due)
      if (due.length === 0 || guard > 1000) return
      guard += 1
      for (const timer of due) {
        if (timer.cancelled) continue
        timer.cancelled = true
        timers.delete(timer)
        timer.callback()
      }
    }
  }

  const ctx = {
    logger: () => logger,
    sessions: { list: () => sessions },
    on(eventName, callback) {
      const entries = listeners.get(eventName) ?? []
      entries.push(callback)
      listeners.set(eventName, entries)
      return () => {
        listeners.set(
          eventName,
          (listeners.get(eventName) ?? []).filter((entry) => entry !== callback),
        )
      }
    },
    timeout(callback, ms) {
      const timer = {
        callback,
        ms,
        due: Date.now() + ms,
        cancelled: false,
        cancel() {
          timer.cancelled = true
          timers.delete(timer)
        },
      }
      timers.add(timer)
      return timer.cancel
    },
    get(name) {
      return services.get(name)
    },
    provide(name, value) {
      services.set(name, value)
      return () => services.delete(name)
    },
    effect(fn) {
      return fn()
    },
    emit(eventName, payload) {
      for (const callback of listeners.get(eventName) ?? []) callback(payload)
    },
    emitSession(session, event) {
      const full = {
        type: event.type,
        data: event.data ?? {},
        seq: event.seq ?? 0,
        time: Date.now(),
      }
      for (const callback of listeners.get('session/event') ?? []) callback(session, full)
    },
    emitUserQuestions(session, value) {
      questionState.set(session.header.id, value)
      projectionListener?.(session, 'userQuestions', value, 0)
    },
    /** Advance the fake clock and run every timer that becomes due. */
    advance(ms) {
      clock.advance(ms)
      runDueTimers()
    },
    logs,
    services,
    listeners,
  }
  return ctx
}

/**
 * Build a started pipeline with a capturing test channel.
 * @returns `{ core, ctx, notifications, clock }`
 */
export async function createCore(options = {}) {
  const clock = installClock(options.startAt)
  const ctx = createMockContext({ ...options, clock })
  const config = resolveConfig({ channels: { macos: { enabled: false } }, ...(options.config ?? {}) })
  const core = new NotixCore(ctx, config, ctx.logger())
  await core.start()
  const notifications = []
  core.channels.register({
    id: 'test',
    async send(notification) {
      notifications.push(notification)
    },
  })
  return { core, ctx, notifications, clock }
}
