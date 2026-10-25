import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCore, createSession } from './mock.js'
import { installTriggers } from '../src/host/triggers/index.js'

async function flush(core) {
  await new Promise((resolve) => setImmediate(resolve))
  await core.chain
}

test('ordinary tool failures notify only when toolErrors is enabled', async () => {
  const session = createSession('s1', 'build')
  const { core, ctx, notifications } = await createCore({
    sessions: [session],
    title: [['s1', 'build']],
    config: { triggers: { error: { toolErrors: true } } },
  })
  installTriggers(ctx, core)
  ctx.emitSession(session, { type: 'tool/call', data: { callId: 'c1', name: 'bash' } })
  ctx.emitSession(session, {
    type: 'tool/result',
    data: { message: { isError: true, toolCallId: 'c1' }, error: { name: 'BashError', message: 'boom' } },
  })
  await flush(core)
  assert.equal(notifications.length, 1)
  assert.match(notifications[0].title, /BashError/)
  assert.equal(notifications[0].body.includes('boom'), false, 'minimal verbosity omits the error message')
})

test('tool timeouts are independently controlled and labelled', async () => {
  const session = createSession('s1')
  const { core, ctx, notifications } = await createCore({
    sessions: [session],
    config: { triggers: { error: { toolTimeout: true } } },
  })
  installTriggers(ctx, core)
  ctx.emitSession(session, {
    type: 'tool/result',
    data: { message: { isError: true, toolCallId: 'c2' }, error: { code: 'TOOL_TIMEOUT', name: 'Timeout' } },
  })
  await flush(core)
  assert.equal(notifications.length, 1)
  assert.match(notifications[0].title, /ToolTimeout/)

  ctx.emitSession(session, {
    type: 'tool/result',
    data: { message: { isError: true, toolCallId: 'c3' }, error: { name: 'BashError' } },
  })
  await flush(core)
  assert.equal(notifications.length, 1, 'ordinary failures stay off while toolErrors is false')
})

test('disabled error trigger suppresses tool notifications', async () => {
  const session = createSession('s1')
  const { core, ctx, notifications } = await createCore({
    sessions: [session],
    config: { triggers: { error: { enabled: false, toolErrors: true } } },
  })
  installTriggers(ctx, core)
  ctx.emitSession(session, {
    type: 'tool/result',
    data: { message: { isError: true, toolCallId: 'c4' }, error: { name: 'BashError' } },
  })
  await flush(core)
  assert.equal(notifications.length, 0)
})
