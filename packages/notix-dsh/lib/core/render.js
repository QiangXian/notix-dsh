/**
 * Notification rendering: trigger facts → localized title and body.
 * @module notix-dsh/core/render
 */

/** Format a millisecond duration for humans. */
export function formatDuration(ms, language) {
  if (ms < 60_000) return language === 'en' ? 'less than a minute' : '不到 1 分钟'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return language === 'en' ? `${minutes} min` : `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (language === 'en') return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`
}

/** Shorten text to at most `max` characters. */
export function truncate(text, max = 200) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/** Read one text block from recorded tool-result content. */
function textOf(content) {
  if (!Array.isArray(content)) return ''
  for (const block of content) if (block?.type === 'text' && typeof block.text === 'string') return block.text
  return ''
}

const ZH = {
  approvalTitle: (toolName) => `需要审批：${toolName || '未知操作'}`,
  approvalBody: (payload, sessionTitle) => [payload.reason, sessionTitle].filter(Boolean).join('\n'),
  questionTitle: () => '需要你的回答',
  questionBody: (payload, sessionTitle) => {
    const first = payload.question ? truncate(payload.question, 160) : 'agent 正在等待你的回答'
    const extra = payload.count > 1 ? `（共 ${payload.count} 个问题）` : ''
    return `${first}${extra}${sessionTitle ? `\n${sessionTitle}` : ''}`
  },
  longTurnTitle: () => '长任务仍在运行',
  longTurnBody: (payload, sessionTitle) =>
    `已运行 ${formatDuration(payload.durationMs, 'zh')}${sessionTitle ? `\n${sessionTitle}` : ''}`,
  longJobTitle: () => '后台任务运行时间较长',
  longJobBody: (payload, sessionTitle) =>
    `${payload.label || '后台任务'} 已运行 ${formatDuration(payload.durationMs, 'zh')}${sessionTitle ? `\n${sessionTitle}` : ''}`,
  errorTitle: (payload) => `执行出错：${payload.errorName || '未知错误'}`,
  errorBody: (payload, sessionTitle, verbosity) =>
    verbosity === 'minimal'
      ? sessionTitle || ''
      : [truncate(payload.message, 200), sessionTitle].filter(Boolean).join('\n'),
  completionTitle: () => '任务完成',
  completionBody: (payload, sessionTitle) =>
    `用时 ${formatDuration(payload.durationMs, 'zh')}${sessionTitle ? `\n${sessionTitle}` : ''}`,
  jobDoneTitle: (payload) => (payload.status === 'failed' ? '后台任务失败' : '后台任务结束'),
  jobDoneBody: (payload, sessionTitle) =>
    [`${payload.label || '后台任务'}：${payload.status || 'completed'}`, sessionTitle].filter(Boolean).join('\n'),
  suppressed: (count) => `另有 ${count} 条同类提醒被合并`,
}

const EN = {
  approvalTitle: (toolName) => `Approval needed: ${toolName || 'unknown action'}`,
  approvalBody: (payload, sessionTitle) => [payload.reason, sessionTitle].filter(Boolean).join('\n'),
  questionTitle: () => 'The agent needs your answer',
  questionBody: (payload, sessionTitle) => {
    const first = payload.question ? truncate(payload.question, 160) : 'The agent is waiting for your answer'
    const extra = payload.count > 1 ? ` (${payload.count} questions)` : ''
    return `${first}${extra}${sessionTitle ? `\n${sessionTitle}` : ''}`
  },
  longTurnTitle: () => 'Long turn still running',
  longTurnBody: (payload, sessionTitle) =>
    `Running for ${formatDuration(payload.durationMs, 'en')}${sessionTitle ? `\n${sessionTitle}` : ''}`,
  longJobTitle: () => 'Background job is taking long',
  longJobBody: (payload, sessionTitle) =>
    `${payload.label || 'Background job'} has run for ${formatDuration(payload.durationMs, 'en')}${sessionTitle ? `\n${sessionTitle}` : ''}`,
  errorTitle: (payload) => `Run failed: ${payload.errorName || 'unknown error'}`,
  errorBody: (payload, sessionTitle, verbosity) =>
    verbosity === 'minimal'
      ? sessionTitle || ''
      : [truncate(payload.message, 200), sessionTitle].filter(Boolean).join('\n'),
  completionTitle: () => 'Task completed',
  completionBody: (payload, sessionTitle) =>
    `Took ${formatDuration(payload.durationMs, 'en')}${sessionTitle ? `\n${sessionTitle}` : ''}`,
  jobDoneTitle: (payload) => (payload.status === 'failed' ? 'Background job failed' : 'Background job finished'),
  jobDoneBody: (payload, sessionTitle) =>
    [`${payload.label || 'Background job'}: ${payload.status || 'completed'}`, sessionTitle].filter(Boolean).join('\n'),
  suppressed: (count) => `${count} similar notifications were merged`,
}

/**
 * Render one trigger into notification text.
 * @param config - resolved Notix configuration.
 * @param trigger - raw trigger facts.
 * @returns the localized title and body, plus whether it is considered urgent.
 */
export function renderNotification(config, trigger) {
  const strings = config.language === 'en' ? EN : ZH
  const sessionTitle = trigger.payload.sessionTitle
  let title
  let body
  switch (trigger.kind) {
    case 'approval':
      title = strings.approvalTitle(trigger.payload.toolName)
      body = strings.approvalBody(trigger.payload, sessionTitle)
      break
    case 'user-question':
      title = strings.questionTitle()
      body = strings.questionBody(trigger.payload, sessionTitle)
      break
    case 'long-task':
      if (trigger.payload.scope === 'job') {
        title = strings.longJobTitle()
        body = strings.longJobBody(trigger.payload, sessionTitle)
      } else {
        title = strings.longTurnTitle()
        body = strings.longTurnBody(trigger.payload, sessionTitle)
      }
      break
    case 'error':
      title = strings.errorTitle(trigger.payload)
      body = strings.errorBody(trigger.payload, sessionTitle, config.verbosity)
      break
    case 'completion':
      if (trigger.payload.scope === 'job') {
        title = strings.jobDoneTitle(trigger.payload)
        body = strings.jobDoneBody(trigger.payload, sessionTitle)
      } else {
        title = strings.completionTitle()
        body = strings.completionBody(trigger.payload, sessionTitle)
      }
      break
    default:
      title = trigger.payload.title ?? 'Notix'
      body = trigger.payload.body ?? ''
  }
  if (trigger.suppressedCount > 0) body = `${body}\n${strings.suppressed(trigger.suppressedCount)}`
  return { title: truncate(title, 120), body: truncate(body, 500) }
}

/** Extract the first question text from a question payload. */
export function firstQuestionText(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return ''
  return questions[0]?.question ?? ''
}

export { textOf }
