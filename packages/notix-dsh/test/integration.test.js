/**
 * Integration test against the real Cordis runtime: verifies the plugin object
 * shape (name/Config/apply), service injection, schema validation, event
 * dispatch, and the `ctx.notix` service face.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import * as notix from '../lib/index.js'

/** Build a real Cordis app with fake session services. */
async function createApp(overrides = {}) {
  const root = new Context()
  await root.plugin(TimerService)
  const sessions = [{ header: { id: 's1' } }]
  root.provide('sessions', { list: () => sessions })
  root.provide('sessionProjections', {
    stateOf() {
      return undefined
    },
    onChanged() {
      return () => {}
    },
  })
  if (overrides.storage !== undefined) root.provide('storageDomain', overrides.storage)
  const notifications = []
  await root.plugin(notix, {
    language: 'en',
    channels: { macos: { enabled: false } },
    triggers: { approval: { remindAfterMs: 60_000 } },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'storage')),
  })
  const service = root.get('notix')
  assert.equal(typeof service?.notify, 'function')
  service.registerChannel({ id: 'test', send: (n) => notifications.push(n) })
  return { root, notifications, sessions }
}

test('plugin loads on a real Cordis runtime and exposes ctx.notix', async () => {
  const app = await createApp()
  try {
    assert.equal(notix.name, 'notix')
    assert.deepEqual(notix.inject, ['sessions', 'timer', 'sessionProjections'])
    assert.equal(typeof notix.Config, 'function')
    const { notifications } = app
    app.root.emit('session/event', app.sessions[0], {
      type: 'approval/asked',
      data: { id: 'a1', toolName: 'bash', reason: 'write files' },
      seq: 1,
      time: Date.now(),
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(notifications.length, 1)
    assert.match(notifications[0].title, /Approval needed/)
    assert.equal(app.root.get('notix').history(10).length, 1)
  } finally {
    await app.root.fiber.dispose()
  }
})

test('manual notifications go through the service API', async () => {
  const app = await createApp()
  try {
    await app.root.get('notix').notify({ title: 'hello', body: 'world', sessionId: 's1' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(app.notifications.length, 1)
    assert.equal(app.notifications[0].title, 'hello')
  } finally {
    await app.root.fiber.dispose()
  }
})

test('the Loader schema applies defaults and rejects invalid values', async () => {
  const app = await createApp()
  try {
    const config = app.root.get('notix').config
    const value = (node) => (typeof node?.get === 'function' ? node.get() : node)
    assert.equal(value(config.triggers.longTask.turnThresholdMs), 600_000)
    assert.equal(value(config.channels.macos.enabled), false)
    // Every editable leaf is volatile, so dsh-settings exposes the namespace.
    assert.equal(value(config.triggers.approval.enabled), true)
  } finally {
    await app.root.fiber.dispose()
  }
  await assert.rejects(async () => {
    await createApp({ language: 'fr' })
  })
})

test('disposing the plugin fiber removes listeners and services', async () => {
  const app = await createApp()
  await app.root.fiber.dispose()
  assert.equal(app.root.get('notix'), undefined)
  app.root.emit('session/event', app.sessions[0], {
    type: 'approval/asked',
    data: { id: 'a2', toolName: 'bash' },
    seq: 2,
    time: Date.now(),
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(app.notifications.length, 0)
})


test('history and dedupe persist through the storage domain', async () => {
  const tables = new Map([
    ['history', new Map()],
    ['dedupe', new Map()],
  ])
  const storage = {
    async open() {
      return {
        table(name) {
          const table = tables.get(name)
          return {
            entries: () => [...table.entries()][Symbol.iterator](),
            get: (key) => table.get(key),
            put: async (key, value) => void table.set(key, value),
            delete: async (key) => table.delete(key),
          }
        },
        async close() {},
      }
    },
  }
  const first = await createApp({ storage })
  await first.root.get('notix').notify({ title: 'durable', body: 'record', sessionId: 's1' })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(tables.get('history').size, 1)
  assert.equal(tables.get('dedupe').size, 1)
  await first.root.fiber.dispose()

  const second = await createApp({ storage })
  try {
    const history = second.root.get('notix').history(10)
    assert.equal(history.length, 1)
    assert.equal(history[0].title, 'durable')
  } finally {
    await second.root.fiber.dispose()
  }
})
