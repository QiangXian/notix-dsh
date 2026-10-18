/**
 * T1 approval trigger: `approval/asked` / `approval/decided` session events.
 *
 * Notix stays a pure observer: it never registers as an answerer, so the
 * approval waterfall keeps its fail-closed semantics.
 * @module notix-dsh/triggers/approval
 */

/**
 * Install the approval trigger.
 * @param ctx - plugin context.
 * @param core - notification pipeline.
 */
export function installApproval(ctx, core) {
  /** @type {Map<string, {sessionId: string, timer?: Function, reminders: number, payload: object}>} */
  const pending = new Map()

  /** Cancel a pending approval's reminder chain. */
  const settle = (id) => {
    const entry = pending.get(id)
    if (entry === undefined) return
    entry.timer?.()
    pending.delete(id)
  }

  /** Schedule the next reminder for one unanswered approval. */
  const schedule = (id, entry) => {
    const rule = core.config.triggers.approval
    if (entry.reminders >= rule.maxReminders || rule.remindAfterMs <= 0) return
    entry.timer = ctx.timeout(() => {
      if (!pending.has(id)) return
      entry.reminders += 1
      const dedupeKey = `approval:${entry.sessionId}:${id}:reminder:${entry.reminders}`
      void core.submit({
        kind: 'approval',
        sessionId: entry.sessionId,
        urgency: 'urgent',
        dedupeKey,
        payload: { ...entry.payload, reminder: entry.reminders },
      })
      schedule(id, entry)
    }, rule.remindAfterMs)
  }

  const onEvent = (session, event) => {
    try {
      const sessionId = session.header.id
      if (event.type === 'approval/asked') {
        const rule = core.config.triggers.approval
        if (!rule.enabled) return
        const id = event.data.id
        const payload = {
          toolName: event.data.toolName,
          reason: event.data.reason,
          sessionTitle: core.sessionTitle(session),
        }
        core.markBusy(sessionId, 'approval')
        void core.submit({
          kind: 'approval',
          sessionId,
          urgency: 'urgent',
          dedupeKey: `approval:${sessionId}:${id}`,
          payload,
        })
        const entry = { sessionId, reminders: 0, payload }
        pending.set(id, entry)
        schedule(id, entry)
        return
      }
      if (event.type === 'approval/decided') {
        settle(event.data.id)
        core.clearBusy(sessionId, 'approval')
      }
    } catch (error) {
      core.logger?.warn(`notix: approval trigger failed: ${String(error)}`)
    }
  }

  ctx.on('session/event', onEvent, { global: true })
}
