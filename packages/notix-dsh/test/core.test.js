import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig, readConfig, unwrapVolatile } from '../lib/config.js'
import { renderNotification, formatDuration, truncate } from '../lib/core/render.js'
import { createCore } from './mock.js'

test('readConfig unwraps volatile references before applying defaults', () => {
  const ref = (value) => Object.freeze({ get: () => value })
  const raw = {
    language: ref('en'),
    triggers: { longTask: ref({ enabled: ref(false), turnThresholdMs: ref(120_000) }) },
  }
  const config = readConfig(raw)
  assert.equal(config.language, 'en')
  assert.equal(config.triggers.longTask.enabled, false)
  assert.equal(config.triggers.longTask.turnThresholdMs, 120_000)
  assert.equal(config.triggers.longTask.jobThresholdMs, 900_000)
  assert.deepEqual(unwrapVolatile({ a: ref([1, ref(2)]) }), { a: [1, 2] })
})

test('resolveConfig fills defaults and keeps overrides', () => {
  const config = resolveConfig({ triggers: { longTask: { turnThresholdMs: 1000 } } })
  assert.equal(config.triggers.longTask.turnThresholdMs, 1000)
  assert.equal(config.triggers.longTask.jobThresholdMs, 900_000)
  assert.equal(config.triggers.approval.enabled, true)
  assert.equal(config.channels.macos.enabled, true)
})

test('renderNotification renders a Chinese approval', () => {
  const config = resolveConfig({})
  const { title, body } = renderNotification(config, {
    kind: 'approval',
    urgency: 'urgent',
    payload: { toolName: 'bash', reason: '写入 dist/', sessionTitle: '构建发布' },
  })
  assert.equal(title, '需要审批：bash')
  assert.match(body, /写入 dist\//)
  assert.match(body, /构建发布/)
})

test('renderNotification renders English completions and merges suppressed counts', () => {
  const config = resolveConfig({ language: 'en' })
  const { title, body } = renderNotification(config, {
    kind: 'completion',
    urgency: 'low',
    suppressedCount: 2,
    payload: { scope: 'turn', durationMs: 125_000, sessionTitle: 'Build release' },
  })
  assert.equal(title, 'Task completed')
  assert.match(body, /2 min/)
  assert.match(body, /2 similar notifications were merged/)
})

test('formatDuration and truncate behave at boundaries', () => {
  assert.equal(formatDuration(30_000, 'zh'), '不到 1 分钟')
  assert.equal(formatDuration(5 * 60_000, 'en'), '5 min')
  assert.equal(formatDuration(90 * 60_000, 'zh'), '1 小时 30 分钟')
  assert.equal(truncate('abcdef', 4), 'abc…')
})

test('pipeline dedupes identical keys', async () => {
    const { core, notifications } = await createCore()
    const trigger = {
      kind: 'approval',
      sessionId: 's1',
      urgency: 'urgent',
      dedupeKey: 'approval:s1:a1',
      payload: { toolName: 'bash', sessionTitle: 'demo' },
    }
    await core.submit(trigger)
    await core.chain
    await core.submit(trigger)
    await core.chain
    assert.equal(notifications.length, 1)
})

test('error cooldown suppresses repeats until the window expires', async () => {
    const { core, notifications, clock } = await createCore({
      config: { triggers: { error: { cooldownMs: 60_000 } } },
    })
    const first = {
      kind: 'error',
      sessionId: 's1',
      urgency: 'normal',
      dedupeKey: 'error:s1:1',
      payload: { errorName: 'LlmError', message: 'boom' },
    }
    await core.submit(first)
    await core.chain
    await core.submit({ ...first, dedupeKey: 'error:s1:2' })
    await core.chain
    assert.equal(notifications.length, 1)
    clock.advance(61_000)
    await core.submit({ ...first, dedupeKey: 'error:s1:3' })
    await core.chain
    assert.equal(notifications.length, 2)
})

test('quiet hours suppress normal notifications but keep urgent ones', async () => {
    const { core, notifications } = await createCore({
      config: {
        quietHours: { enabled: true, from: '00:00', to: '23:59', allowUrgent: true },
      },
    })
    await core.submit({
      kind: 'long-task',
      sessionId: 's1',
      urgency: 'normal',
      dedupeKey: 'longturn:s1:1',
      payload: { scope: 'turn', durationMs: 1 },
    })
    await core.chain
    assert.equal(notifications.length, 0)
    await core.submit({
      kind: 'approval',
      sessionId: 's1',
      urgency: 'urgent',
      dedupeKey: 'approval:s1:a1',
      payload: { toolName: 'bash' },
    })
    await core.chain
    assert.equal(notifications.length, 1)
})

test('history records delivered notifications', async () => {
    const { core } = await createCore()
    await core.notify({ title: 'hi', body: 'there', sessionId: 's1' })
    await core.chain
    const history = core.store.history(10)
    assert.equal(history.length, 1)
    assert.equal(history[0].title, 'hi')
    assert.equal(history[0].delivered, true)
    assert.deepEqual(history[0].channels, ['test'])
})
