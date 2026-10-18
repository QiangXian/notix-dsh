/**
 * T3 long-task trigger: turn and background-job duration watchdogs.
 * @module notix-dsh/triggers/long-task
 */

const BUSY_RECHECK_MS = 30_000

/**
 * Install the long-task trigger.
 * @param ctx - plugin context.
 * @param core - notification pipeline.
 */
export function installLongTask(ctx, core) {
  const rule = () => core.config.triggers.longTask
  /** @type {Map<string, {timer?: Function, startedAt: number, sessionId: string, turn: number}>} */
  const turns = new Map()
  /** @type {Map<string, {timer?: Function, startedAt: number, sessionId: string, label: string}>} */
  const jobs = new Map()

  /** Fire or defer one turn watchdog. */
  const watchTurn = (key, entry) => {
    const ruleNow = rule()
    entry.timer = ctx.timeout(() => {
      if (!turns.has(key)) return
      const sessionId = entry.sessionId
      if (core.isBusy(sessionId)) {
        // The agent is blocked on the user; T1/T2 already cover this period.
        watchTurn(key, entry)
        return
      }
      void core.submit({
        kind: 'long-task',
        sessionId,
        urgency: 'normal',
        dedupeKey: `longturn:${sessionId}:${entry.turn}`,
        payload: {
          scope: 'turn',
          turn: entry.turn,
          durationMs: Date.now() - entry.startedAt,
          thresholdMs: ruleNow.turnThresholdMs,
        },
      })
    }, ruleNow.turnThresholdMs)
  }

  /** Fire one job watchdog, deferring while the agent is blocked. */
  const watchJob = (jobId, entry) => {
    const ruleNow = rule()
    entry.timer = ctx.timeout(() => {
      if (!jobs.has(jobId)) return
      if (core.isBusy(entry.sessionId)) {
        watchJob(jobId, entry)
        return
      }
      void core.submit({
        kind: 'long-task',
        sessionId: entry.sessionId,
        urgency: 'normal',
        dedupeKey: `longjob:${entry.sessionId}:${jobId}`,
        payload: {
          scope: 'job',
          jobId,
          label: entry.label,
          durationMs: Date.now() - entry.startedAt,
          thresholdMs: ruleNow.jobThresholdMs,
        },
      })
    }, ruleNow.jobThresholdMs)
  }

  const onEvent = (session, event) => {
    try {
      const sessionId = session.header.id
      const current = rule()
      if (event.type === 'turn/start') {
        const turn = event.data.turn
        const key = `${sessionId}:${turn}`
        const startedAt = Date.now()
        core.beginTurn(session, turn)
        if (!current.enabled || current.turnThresholdMs <= 0) return
        const entry = { startedAt, sessionId, turn }
        turns.set(key, entry)
        watchTurn(key, entry)
        return
      }
      if (event.type === 'turn/end') {
        const key = `${sessionId}:${event.data.turn}`
        const entry = turns.get(key)
        entry?.timer?.()
        turns.delete(key)
        return
      }
      if (event.type === 'job/registered') {
        const jobId = event.data.jobId
        if (typeof jobId !== 'string') return
        const startedAt = Number(event.data.startedAt) || Date.now()
        const label = event.data.label ?? event.data.kind ?? 'job'
        core.beginJob(jobId, label)
        if (!current.enabled || current.jobThresholdMs <= 0) return
        const entry = { startedAt, sessionId, label }
        jobs.set(jobId, entry)
        watchJob(jobId, entry)
        return
      }
      if (event.type === 'job/settled') {
        const jobId = event.data.jobId
        const entry = jobs.get(jobId)
        entry?.timer?.()
        jobs.delete(jobId)
        core.endJob(jobId)
      }
    } catch (error) {
      core.logger?.warn(`notix: long-task trigger failed: ${String(error)}`)
    }
  }

  ctx.on('session/event', onEvent, { global: true })

  // A plugin reload should not leave watchdogs armed for turns that ended.
  ctx.effect(() => () => {
    for (const entry of turns.values()) entry.timer?.()
    turns.clear()
    for (const entry of jobs.values()) entry.timer?.()
    jobs.clear()
  }, 'notix: long-task watchdogs')
}
