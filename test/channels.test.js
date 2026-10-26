/**
 * Unit tests for the shared SystemChannel base class and the built-in channel
 * registry. The runtime platform and the tool runner are always injected, so
 * these tests never touch the notification tooling of the real OS.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SystemChannel } from '../src/host/channels/base.js'
import { MacosChannel } from '../src/host/channels/macos.js'
import { WindowsChannel } from '../src/host/channels/windows.js'
import { BUILTIN_CHANNELS, platformChannel, createPlatformChannels } from '../src/host/channels/index.js'

const logger = { info() {}, warn() {}, debug() {} }

/**
 * Build a minimal SystemChannel subclass with an observable backend.
 * @param options - `{ config, getConfig, platform, run, failures, label }`.
 * @returns `{ channel, state, config }` where `state` counts detections/deliveries.
 */
function createFakeChannel(options = {}) {
  const state = { detections: 0, deliveries: [] }
  const config = options.config ?? { enabled: true }
  class FakeChannel extends SystemChannel {
    get id() {
      return 'fake-system'
    }

    get platform() {
      return 'testos'
    }

    get platformLabel() {
      return options.label ?? 'TestOS'
    }

    async detectBackend() {
      state.detections += 1
      if (state.detections <= (options.failures ?? 0)) throw new Error('no test backend')
      return { kind: 'fake' }
    }

    async deliver(backend, notification) {
      state.deliveries.push({ backend, notification })
    }
  }
  const channel = new FakeChannel(options.getConfig ?? (() => config), logger, {
    platform: options.platform ?? 'testos',
    ...(options.run === undefined ? {} : { run: options.run }),
  })
  return { channel, state, config }
}

test('platform guard rejects unsupported runtimes with id and platform label', async () => {
  const { channel, state } = createFakeChannel({ platform: 'linux' })
  assert.equal(channel.supported, false)
  await assert.rejects(
    channel.send({ title: 'T', body: 'B' }),
    /fake-system channel is only available on TestOS/,
  )
  assert.equal(state.detections, 0, 'detection must not run on an unsupported platform')
  assert.equal(state.deliveries.length, 0)

  // The base class falls back to the adapter's platform when no label is given.
  class BareChannel extends SystemChannel {
    get id() {
      return 'bare-system'
    }

    get platform() {
      return 'testos'
    }
  }
  const bare = new BareChannel(() => ({}), logger, { platform: 'linux' })
  await assert.rejects(
    bare.send({ title: 'T', body: 'B' }),
    /bare-system channel is only available on testos/,
  )
})

test('a successful backend detection is cached across sends', async () => {
  const { channel, state } = createFakeChannel()
  await channel.send({ title: 'one', body: 'first' })
  await channel.send({ title: 'two', body: 'second' })
  assert.equal(state.detections, 1, 'detectBackend() must run exactly once')
  assert.deepEqual(
    state.deliveries.map((entry) => entry.notification.title),
    ['one', 'two'],
  )
  assert.deepEqual(state.deliveries[0].backend, { kind: 'fake' })
})

test('a failed backend detection is not cached and the next send retries', async () => {
  const { channel, state } = createFakeChannel({ failures: 1 })
  assert.equal(channel.backend, undefined)
  await assert.rejects(channel.send({ title: 'T', body: 'B' }), /no test backend/)
  assert.equal(channel.backend, undefined, 'a failure must not be cached')
  await channel.send({ title: 'T', body: 'B' })
  assert.equal(state.detections, 2)
  assert.equal(state.deliveries.length, 1)
})

test('configuration getters derive enabled, sound and click-to-open URL', () => {
  const unset = createFakeChannel({ getConfig: () => undefined })
  assert.deepEqual(unset.channel.config, {})
  assert.equal(unset.channel.enabled, true)
  assert.equal(unset.channel.sound, true)
  assert.equal(unset.channel.clickUrl, '')

  const off = createFakeChannel({
    config: { enabled: false, sound: false, clickToOpen: false, baseUrl: 'https://example.test/' },
  }).channel
  assert.equal(off.enabled, false)
  assert.equal(off.sound, false)
  assert.equal(off.clickUrl, '')

  const trimmed = createFakeChannel({
    config: { clickToOpen: true, baseUrl: '  https://example.test/path  ' },
  }).channel
  assert.equal(trimmed.clickUrl, 'https://example.test/path')

  assert.equal(
    createFakeChannel({ config: { clickToOpen: true, baseUrl: '   ' } }).channel.clickUrl,
    '',
  )
  assert.equal(createFakeChannel({ config: { clickToOpen: true, baseUrl: 42 } }).channel.clickUrl, '')
  assert.equal(createFakeChannel({ config: { clickToOpen: true } }).channel.clickUrl, '')
  assert.equal(
    createFakeChannel({ config: { clickToOpen: 'yes', baseUrl: 'https://example.test/' } }).channel
      .clickUrl,
    '',
  )

  // The configuration is read live, not snapshotted in the constructor.
  const live = createFakeChannel({ config: { enabled: true, sound: true } })
  live.config.sound = false
  live.config.enabled = false
  assert.equal(live.channel.sound, false)
  assert.equal(live.channel.enabled, false)
})

test('run() delegates to the injected runner for deterministic tests', async () => {
  const calls = []
  const run = async (file, args, runOptions) => {
    calls.push({ file, args, runOptions })
    return 'ok'
  }
  const { channel } = createFakeChannel({ run })
  assert.equal(await channel.run('tool', ['--flag'], { env: { A: '1' } }), 'ok')
  assert.deepEqual(calls, [{ file: 'tool', args: ['--flag'], runOptions: { env: { A: '1' } } }])
})

test('BUILTIN_CHANNELS maps each supported platform to its config key', () => {
  assert.deepEqual(Object.keys(BUILTIN_CHANNELS), ['darwin', 'win32'])
  assert.equal(BUILTIN_CHANNELS.darwin.configKey, 'macos')
  assert.equal(BUILTIN_CHANNELS.win32.configKey, 'windows')
  assert.equal(platformChannel('darwin'), BUILTIN_CHANNELS.darwin)
  assert.equal(platformChannel('win32'), BUILTIN_CHANNELS.win32)
  assert.equal(platformChannel('linux'), undefined)
})

test('createPlatformChannels creates the enabled adapter for a supported platform', () => {
  const calls = []
  const resolve = (map) => (key) => {
    calls.push(key)
    return map[key]
  }

  const macos = createPlatformChannels(resolve({ macos: { enabled: true } }), logger, 'darwin')
  assert.equal(macos.platform, 'darwin')
  assert.equal(macos.configKey, 'macos')
  assert.equal(macos.channels.length, 1)
  assert.ok(macos.channels[0] instanceof MacosChannel)
  assert.equal(macos.channels[0].id, 'macos-system')
  assert.equal(macos.channels[0].platform, 'darwin')

  const windows = createPlatformChannels(resolve({ windows: { enabled: true } }), logger, 'win32')
  assert.equal(windows.platform, 'win32')
  assert.equal(windows.configKey, 'windows')
  assert.equal(windows.channels.length, 1)
  assert.ok(windows.channels[0] instanceof WindowsChannel)
  assert.equal(windows.channels[0].id, 'windows-system')
  assert.equal(windows.channels[0].platform, 'win32')
  assert.deepEqual(calls, ['macos', 'windows'])

  // The returned adapter reads the live channel configuration, so Settings
  // edits take effect without rebuilding it.
  let live = { enabled: true, sound: true }
  const created = createPlatformChannels(() => live, logger, 'darwin')
  assert.equal(created.channels[0].sound, true)
  live = { enabled: true, sound: false }
  assert.equal(created.channels[0].sound, false)
})

test('createPlatformChannels skips disabled channels and unsupported platforms', () => {
  const disabled = createPlatformChannels(() => ({ enabled: false }), logger, 'darwin')
  assert.equal(disabled.configKey, 'macos')
  assert.deepEqual(disabled.channels, [])

  // Enabling is explicit: a missing flag matches the Loader default of false.
  assert.deepEqual(createPlatformChannels(() => ({}), logger, 'win32').channels, [])
  assert.deepEqual(createPlatformChannels(() => undefined, logger, 'darwin').channels, [])

  const calls = []
  const resolve = (key) => {
    calls.push(key)
    return { enabled: true }
  }
  const linux = createPlatformChannels(resolve, logger, 'linux')
  assert.equal(linux.platform, 'linux')
  assert.equal(linux.configKey, undefined)
  assert.deepEqual(linux.channels, [])
  const unknown = createPlatformChannels(resolve, logger, 'freebsd')
  assert.equal(unknown.configKey, undefined)
  assert.deepEqual(unknown.channels, [])
  assert.deepEqual(calls, [], 'an unsupported platform must not read channel config')
})
