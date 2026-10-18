/**
 * T5 completion trigger: long turns that finish, and settled background jobs.
 * @module notix-dsh/triggers/completion
 */

/**
 * Install the completion trigger.
 * @param ctx - plugin context.
 * @param core - notification pipeline.
 */
export function installCompletion(ctx, core) {
  const rule = () => core.config.triggers.completion

  const onEvent = (session, event) => {
    try {
      const sessionId = session.header.id
      if (event.type === 'turn/end') {
        const current = rule()
        // Always consume the recorded start so the map cannot leak.
        const durationMs = core.endTurn(session, event.data.turn)
        if (!current.enabled) return
        if (event.data.reason?.kind !== 'completed') return
        if (durationMs < current.minDurationMs) return
        void core.submit({
          kind: 'completion',
          sessionId,
          urgency: 'low',
          dedupeKey: `completion:${sessionId}:${event.data.turn}`,
          payload: { scope: 'turn', turn: event.data.turn, durationMs, sessionTitle: core.sessionTitle(session) },
        })
        return
      }
      if (event.type === 'job/settled') {
        const current = rule()
        const jobId = event.data.jobId
        const facts = core.endJob(jobId)
        if (!current.enabled || !current.jobs) return
        const status = event.data.status ?? 'completed'
        void core.submit({
          kind: 'completion',
          sessionId,
          urgency: status === 'failed' ? 'normal' : 'low',
          dedupeKey: `jobdone:${sessionId}:${jobId}`,
          payload: {
            scope: 'job',
            jobId,
            status,
            label: facts?.label ?? event.data.label ?? 'job',
            durationMs: facts === undefined ? 0 : Date.now() - facts.startedAt,
            sessionTitle: core.sessionTitle(session),
          },
        })
      }
    } catch (error) {
      core.logger?.warn(`notix: completion trigger failed: ${String(error)}`)
    }
  }

  ctx.on('session/event', onEvent, { global: true })
}
