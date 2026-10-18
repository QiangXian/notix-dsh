/**
 * T4 error trigger: terminal turn failures, agent errors, and optional tool failures.
 * @module notix-dsh/triggers/error
 */

/**
 * Install the error trigger.
 * @param ctx - plugin context.
 * @param core - notification pipeline.
 */
export function installError(ctx, core) {
  const rule = () => core.config.triggers.error
  /** @type {Map<string, string>} toolCallId → tool name */
  const toolNames = new Map()

  /** Normalize an error name/message from a turn or agent error payload. */
  const describe = (error) => {
    if (error === undefined || error === null) return { errorName: 'Error', message: '' }
    const errorName = error.code ?? error.name ?? error.kind ?? 'Error'
    const message = typeof error.message === 'string' ? error.message : String(error)
    return { errorName, message }
  }

  const onSessionEvent = (session, event) => {
    try {
      const sessionId = session.header.id
      if (event.type === 'turn/end') {
        if (event.data.reason?.kind !== 'error') return
        if (!rule().enabled) return
        const { errorName, message } = describe(event.data.reason.error)
        void core.submit({
          kind: 'error',
          sessionId,
          urgency: 'normal',
          dedupeKey: `error:${sessionId}:${event.data.turn}`,
          payload: { scope: 'turn', turn: event.data.turn, errorName, message, sessionTitle: core.sessionTitle(session) },
        })
        return
      }
      if (event.type === 'tool/call') {
        if (typeof event.data.callId === 'string' && typeof event.data.name === 'string') {
          toolNames.set(event.data.callId, event.data.name)
          if (toolNames.size > 200) {
            const oldest = toolNames.keys().next().value
            toolNames.delete(oldest)
          }
        }
        return
      }
      if (event.type === 'tool/result') {
        const current = rule()
        if (!current.enabled) return
        const message = event.data.message
        if (message?.isError !== true) return
        const info = event.data.error ?? {}
        const code = info.code ?? ''
        const isTimeout = code === 'TOOL_TIMEOUT' || info.name === 'ToolTimeoutError'
        if (isTimeout ? !current.toolTimeout : !current.toolErrors) return
        const toolCallId = message.toolCallId
        const toolName = toolNames.get(toolCallId) ?? info.name ?? 'tool'
        void core.submit({
          kind: 'error',
          sessionId,
          urgency: 'normal',
          dedupeKey: `toolerror:${sessionId}:${toolCallId}`,
          payload: {
            scope: 'tool',
            toolName,
            errorName: isTimeout ? 'ToolTimeout' : (info.name ?? 'ToolError'),
            message: info.message ?? '',
            sessionTitle: core.sessionTitle(session),
          },
        })
      }
    } catch (error) {
      core.logger?.warn(`notix: error trigger failed: ${String(error)}`)
    }
  }

  const onAgentError = (payload) => {
    try {
      if (!rule().enabled) return
      const agent = payload?.agent
      const session = agent?.session
      if (session === undefined) return
      const sessionId = session.header.id
      const { errorName, message } = describe(payload.error)
      // Same dedupe key as turn/end so one turn yields one error notification.
      void core.submit({
        kind: 'error',
        sessionId,
        urgency: 'normal',
        dedupeKey: `error:${sessionId}:${payload.turn}`,
        payload: { scope: 'turn', turn: payload.turn, step: payload.step, errorName, message, sessionTitle: core.sessionTitle(session) },
      })
    } catch (error) {
      core.logger?.warn(`notix: agent error trigger failed: ${String(error)}`)
    }
  }

  ctx.on('session/event', onSessionEvent, { global: true })
  ctx.on('agent/error', onAgentError, { global: true })
}
