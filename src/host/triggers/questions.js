/**
 * T2 user-question trigger: the `userQuestions` session projection.
 *
 * The projection is the client-facing semantic state (open / continued /
 * settled), so Notix sees exactly the pending set the GUI shows.
 * @module notix-dsh/triggers/questions
 */

/**
 * Read the active question list of one session.
 *
 * `stateOf()` returns the raw Host projection state, whose question view is
 * nested under `questions` (`{ inheritedEventCount, timed, questions }`).
 * The `onChanged` feed below already delivers that nested view as `value`,
 * so only the seeding path has to unwrap it.
 */
function activeQuestions(ctx, session) {
  try {
    const state = ctx.get('sessionProjections')?.stateOf(session, 'userQuestions')
    return Array.isArray(state?.questions?.active) ? state.questions.active : []
  } catch {
    return []
  }
}

/**
 * Install the user-question trigger.
 * @param ctx - plugin context.
 * @param core - notification pipeline.
 */
export function installQuestions(ctx, core) {
  /** @type {Map<string, {open: Set<string>, continued: Set<string>}>} sessionId → announced callIds */
  const announced = new Map()
  /** @type {Map<string, {timer?: Function, sessionId: string, callId: string, reminders: number, payload: object}>} */
  const reminders = new Map()

  /** Cancel one question's reminder chain. */
  const settle = (callId) => {
    const entry = reminders.get(callId)
    if (entry === undefined) return
    entry.timer?.()
    reminders.delete(callId)
  }

  /** Schedule the next reminder for one still-open question. */
  const schedule = (callId, entry) => {
    const rule = core.config.triggers.userQuestion
    if (entry.reminders >= (rule.maxReminders ?? 2) || rule.remindAfterMs <= 0) return
    entry.timer = ctx.timeout(() => {
      if (!reminders.has(callId)) return
      entry.reminders += 1
      void core.submit({
        kind: 'user-question',
        sessionId: entry.sessionId,
        urgency: 'urgent',
        dedupeKey: `question:${entry.sessionId}:${callId}:reminder:${entry.reminders}`,
        payload: { ...entry.payload, reminder: entry.reminders },
      })
      schedule(callId, entry)
    }, rule.remindAfterMs)
  }

  /** Note the current topic set and emit notifications for newly opened questions. */
  const observe = (session, questions) => {
    const sessionId = session.header.id
    let seen = announced.get(sessionId)
    if (seen === undefined) {
      seen = { open: new Set(), continued: new Set() }
      announced.set(sessionId, seen)
    }
    const rule = core.config.triggers.userQuestion
    for (const question of questions) {
      const callId = question?.callId
      if (typeof callId !== 'string') continue
      const state = question.state
      if (state === 'open' && !seen.open.has(callId)) {
        seen.open.add(callId)
        if (rule.enabled) {
          const payload = {
            callId,
            count: Array.isArray(question.questions) ? question.questions.length : 0,
            question: question.questions?.[0]?.question ?? '',
            sessionTitle: core.sessionTitle(session),
          }
          void core.submit({
            kind: 'user-question',
            sessionId,
            urgency: 'urgent',
            dedupeKey: `question:${sessionId}:${callId}`,
            payload,
          })
          const entry = { sessionId, callId, reminders: 0, payload }
          reminders.set(callId, entry)
          schedule(callId, entry)
        }
        continue
      }
      if (state === 'continued' && !seen.continued.has(callId)) {
        seen.continued.add(callId)
        if (rule.enabled && rule.remindOnContinued) {
          void core.submit({
            kind: 'user-question',
            sessionId,
            urgency: 'urgent',
            dedupeKey: `question:${sessionId}:${callId}:continued`,
            payload: {
              callId,
              count: Array.isArray(question.questions) ? question.questions.length : 0,
              question: question.questions?.[0]?.question ?? '',
              continued: true,
              sessionTitle: core.sessionTitle(session),
            },
          })
        }
      }
    }
    // Questions that left the active set no longer need reminders.
    const stillActive = new Set(questions.map((question) => question?.callId).filter((id) => typeof id === 'string'))
    for (const callId of reminders.keys()) {
      const entry = reminders.get(callId)
      if (entry !== undefined && entry.sessionId === sessionId && !stillActive.has(callId)) settle(callId)
    }
    // Track busy state for long-task suppression.
    if (questions.length > 0) core.markBusy(sessionId, 'question')
    else core.clearBusy(sessionId, 'question')
  }

  // Seed from live sessions so pre-existing questions do not notify on reload.
  /** Record already-open questions as seen without announcing or reminding them. */
  const seed = (session, questions) => {
    const sessionId = session.header.id
    const seen = { open: new Set(), continued: new Set() }
    for (const question of questions) {
      const callId = question?.callId
      if (typeof callId !== 'string') continue
      if (question.state === 'open') seen.open.add(callId)
      else if (question.state === 'continued') seen.continued.add(callId)
    }
    announced.set(sessionId, seen)
    // The agent is already blocked on the user; keep the long-task watchdogs
    // quiet, but never arm the reminder chain for a question the user has seen.
    if (questions.length > 0) core.markBusy(sessionId, 'question')
    else core.clearBusy(sessionId, 'question')
  }

  try {
    for (const session of ctx.sessions.list()) seed(session, activeQuestions(ctx, session))
  } catch (error) {
    core.logger?.warn(`notix: seeding user questions failed: ${String(error)}`)
  }

  const projections = ctx.get('sessionProjections')
  if (projections === undefined || typeof projections.onChanged !== 'function') {
    core.logger?.warn('notix: sessionProjections unavailable; the user-question trigger is disabled')
    return
  }
  projections.onChanged((session, key, value) => {
    try {
      if (key !== 'userQuestions') return
      const questions = Array.isArray(value?.active) ? value.active : []
      observe(session, questions)
    } catch (error) {
      core.logger?.warn(`notix: question trigger failed: ${String(error)}`)
    }
  })

  // Drop tracking state for disposed sessions.
  ctx.on(
    'session/disposed',
    (session) => {
      announced.delete(session.header.id)
      for (const [callId, entry] of reminders) if (entry.sessionId === session.header.id) settle(callId)
      core.clearBusy(session.header.id, 'question')
    },
    { global: true },
  )
}
