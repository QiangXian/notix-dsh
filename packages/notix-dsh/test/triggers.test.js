import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCore, createSession } from './mock.js'
import { installTriggers } from '../lib/triggers/index.js'

/** Wait for queued deliveries to settle. */
async function flush(core) {
  await new Promise((resolve) => setImmediate(resolve))
  await core.chain
}

test('approval/asked notifies and reminders stop after decided', async () => {
    const session = createSession('s1', 'demo session')
    const { core, ctx, notifications } = await createCore({
      sessions: [session],
      title: [['s1', 'demo session']],
      config: { triggers: { approval: { remindAfterMs: 1000, maxReminders: 2 } } },
    })
    installTriggers(ctx, core)

    ctx.emitSession(session, { type: 'approval/asked', data: { id: 'a1', toolName: 'bash', reason: 'write dist' } })
    await flush(core)
    assert.equal(notifications.length, 1)
    assert.match(notifications[0].title, /需要审批/)
    assert.match(notifications[0].body, /write dist/)
    assert.equal(core.isBusy('s1'), true)

    ctx.advance(1000)
    await flush(core)
    assert.equal(notifications.length, 2, 'one reminder is sent')

    ctx.emitSession(session, { type: 'approval/decided', data: { id: 'a1', outcome: 'allowed-once' } })
    ctx.advance(10_000)
    await flush(core)
    assert.equal(notifications.length, 2, 'decided stops the reminder chain')
    assert.equal(core.isBusy('s1'), false)
})

test('user questions notify on open and continued, tracking busy state', async () => {
    const session = createSession('s1', 'demo')
    const { core, ctx, notifications, clock } = await createCore({ sessions: [session] })
    installTriggers(ctx, core)

    ctx.emitUserQuestions(session, {
      active: [{ callId: 'c1', state: 'open', questions: [{ id: 'q1', question: '用哪个分支？' }] }],
      settled: [],
    })
    await flush(core)
    assert.equal(notifications.length, 1)
    assert.match(notifications[0].body, /用哪个分支/)
    assert.equal(core.isBusy('s1'), true)

    ctx.emitUserQuestions(session, {
      active: [{ callId: 'c1', state: 'continued', questions: [{ id: 'q1', question: '用哪个分支？' }] }],
      settled: [],
    })
    await flush(core)
    assert.equal(notifications.length, 2, 'continued questions notify once')

    ctx.emitUserQuestions(session, { active: [], settled: [{ callId: 'c1', answers: [] }] })
    await flush(core)
    assert.equal(core.isBusy('s1'), false)
    assert.equal(notifications.length, 2)
})

test('turn watchdog fires once when a turn runs too long', async () => {
    const session = createSession('s1', 'build')
    const { core, ctx, notifications } = await createCore({
      sessions: [session],
      title: [['s1', 'build']],
      config: { triggers: { longTask: { turnThresholdMs: 1000, jobThresholdMs: 0 } } },
    })
    installTriggers(ctx, core)
    ctx.emitSession(session, { type: 'turn/start', data: { turn: 1 } })
    ctx.advance(1000)
    await flush(core)
    assert.equal(notifications.length, 1)
    assert.match(notifications[0].title, /长任务/)
    ctx.emitSession(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    ctx.advance(10_000)
    await flush(core)
    assert.equal(notifications.length, 1, 'turn/end clears the watchdog')
})

test('turn watchdog defers while the agent waits on the user', async () => {
    const session = createSession('s1')
    const { core, ctx, notifications } = await createCore({
      sessions: [session],
      config: { triggers: { longTask: { turnThresholdMs: 1000, jobThresholdMs: 0 } } },
    })
    installTriggers(ctx, core)
    ctx.emitSession(session, { type: 'turn/start', data: { turn: 1 } })
    ctx.emitSession(session, { type: 'approval/asked', data: { id: 'a1', toolName: 'bash' } })
    ctx.advance(1000)
    await flush(core)
    // One approval notification, no long-task notification while busy.
    assert.equal(notifications.filter((n) => n.kind === 'long-task').length, 0)
    ctx.emitSession(session, { type: 'approval/decided', data: { id: 'a1', outcome: 'rejected' } })
    ctx.advance(1000)
    await flush(core)
    assert.equal(notifications.filter((n) => n.kind === 'long-task').length, 1)
})

test('terminal turn errors notify once across agent/error and turn/end', async () => {
    const session = createSession('s1')
    const { core, ctx, notifications, clock } = await createCore({ sessions: [session] })
    installTriggers(ctx, core)
    ctx.emit('agent/error', {
      agent: { session },
      turn: 1,
      step: 2,
      error: { name: 'LlmError', message: 'rate limited' },
    })
    await flush(core)
    ctx.emitSession(session, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'error', error: { code: 'LLM_ERROR', message: 'rate limited' } } },
    })
    await flush(core)
    assert.equal(notifications.length, 1)
    assert.match(notifications[0].title, /执行出错/)
})

test('long turns notify completion after the configured minimum', async () => {
    const session = createSession('s1', 'release')
    const { core, ctx, notifications, clock } = await createCore({ sessions: [session] })
    installTriggers(ctx, core)
    ctx.emitSession(session, { type: 'turn/start', data: { turn: 1 } })
    clock.advance(4 * 60_000)
    ctx.emitSession(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await flush(core)
    assert.equal(notifications.length, 1)
    assert.match(notifications[0].title, /任务完成/)
    assert.match(notifications[0].body, /4 分钟/)
})

test('short turns do not notify completion', async () => {
    const session = createSession('s1')
    const { core, ctx, notifications, clock } = await createCore({ sessions: [session] })
    installTriggers(ctx, core)
    ctx.emitSession(session, { type: 'turn/start', data: { turn: 1 } })
    clock.advance(10_000)
    ctx.emitSession(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await flush(core)
    assert.equal(notifications.length, 0)
})

test('settled background jobs notify completion when job notifications are enabled', async () => {
    const session = createSession('s1', 'deploy')
    const { core, ctx, notifications, clock } = await createCore({
      sessions: [session],
      config: { triggers: { completion: { jobs: true } } },
    })
    installTriggers(ctx, core)
    ctx.emitSession(session, {
      type: 'job/registered',
      data: { jobId: 'j1', kind: 'bash', label: 'pnpm build', startedAt: Date.now() },
    })
    clock.advance(60_000)
    ctx.emitSession(session, {
      type: 'job/settled',
      data: { jobId: 'j1', kind: 'bash', label: 'pnpm build', status: 'completed' },
    })
    await flush(core)
    assert.equal(notifications.length, 1)
    assert.match(notifications[0].title, /后台任务结束/)
})

test('settled background jobs stay silent by default', async () => {
    const session = createSession('s1', 'deploy')
    const { core, ctx, notifications, clock } = await createCore({ sessions: [session] })
    installTriggers(ctx, core)
    ctx.emitSession(session, {
      type: 'job/registered',
      data: { jobId: 'j1', kind: 'bash', label: 'pnpm build', startedAt: Date.now() },
    })
    clock.advance(60_000)
    ctx.emitSession(session, {
      type: 'job/settled',
      data: { jobId: 'j1', kind: 'bash', label: 'pnpm build', status: 'completed' },
    })
    await flush(core)
    assert.equal(notifications.length, 0)
})

test('job watchdog stays off by default and fires when jobs are enabled', async () => {
    const session = createSession('s1', 'deploy')
    const quiet = await createCore({
      sessions: [session],
      config: { triggers: { longTask: { turnThresholdMs: 0, jobThresholdMs: 1000 } } },
    })
    installTriggers(quiet.ctx, quiet.core)
    quiet.ctx.emitSession(session, {
      type: 'job/registered',
      data: { jobId: 'j1', kind: 'bash', label: 'pnpm build', startedAt: Date.now() },
    })
    quiet.ctx.advance(10_000)
    await flush(quiet.core)
    assert.equal(quiet.notifications.filter((n) => n.kind === 'long-task').length, 0, 'jobs off by default: no watchdog')

    const session2 = createSession('s2', 'deploy')
    const loud = await createCore({
      sessions: [session2],
      config: { triggers: { longTask: { turnThresholdMs: 0, jobThresholdMs: 1000, jobs: true } } },
    })
    installTriggers(loud.ctx, loud.core)
    loud.ctx.emitSession(session2, {
      type: 'job/registered',
      data: { jobId: 'j2', kind: 'bash', label: 'pnpm build', startedAt: Date.now() },
    })
    loud.ctx.advance(1000)
    await flush(loud.core)
    assert.equal(loud.notifications.filter((n) => n.kind === 'long-task').length, 1, 'jobs on: watchdog fires')
})


test('open questions get reminder chains that stop when answered', async () => {
  const { core, ctx, notifications } = await createCore({
    sessions: [createSession('s1')],
    config: { triggers: { userQuestion: { remindAfterMs: 1000, maxReminders: 1 } } },
  })
  installTriggers(ctx, core)
  const session = createSession('s1')
  ctx.emitUserQuestions(session, {
    active: [{ callId: 'c9', state: 'open', questions: [{ id: 'q', question: '继续吗？' }] }],
    settled: [],
  })
  await flush(core)
  assert.equal(notifications.length, 1)
  ctx.advance(1000)
  await flush(core)
  assert.equal(notifications.length, 2, 'one reminder fires')
  ctx.emitUserQuestions(session, { active: [], settled: [{ callId: 'c9', answers: [] }] })
  ctx.advance(10_000)
  await flush(core)
  assert.equal(notifications.length, 2, 'answering stops the reminder chain')
})
