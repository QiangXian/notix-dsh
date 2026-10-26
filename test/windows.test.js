/**
 * Unit tests for the Windows toast channel.
 *
 * Delivery is exercised through an injected runner and a temporary fake
 * powershell file, so the automated suite never spawns PowerShell or posts a
 * real toast. The one end-to-end case is opt-in on a real Windows host with
 * `NOTIX_TOAST_E2E=1`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_APP_ID,
  APP_DISPLAY_NAME,
  toastTag,
  toastArguments,
  toastEnvironment,
  WindowsChannel,
} from '../src/host/channels/windows.js'
import { BUNDLED_ICON } from '../src/host/channels/shared.js'

const bundledIcon = fileURLToPath(new URL('../assets/notifier-icon.png', import.meta.url))
const silentLogger = { info() {}, warn() {}, debug() {} }

/** A complete `channels.windows` configuration block. */
function config(overrides = {}) {
  return {
    enabled: true,
    sound: true,
    clickToOpen: true,
    baseUrl: 'http://127.0.0.1:62200/',
    appId: '',
    icon: '',
    ...overrides,
  }
}

/** Create a temporary directory with a file that satisfies existsSync(). */
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'notix-windows-test-'))
  const shell = join(dir, 'powershell.exe')
  await writeFile(shell, '# fake Windows PowerShell executable\n')
  return { dir, shell }
}

test('channel advertises the win32 system identity and reads live configuration', () => {
  const settings = config({
    enabled: true,
    sound: false,
    clickToOpen: true,
    baseUrl: '  https://example.test/open  ',
    appId: 'Contoso.Notix',
    icon: '/tmp/custom.png',
  })
  const channel = new WindowsChannel(() => settings, silentLogger)
  assert.equal(channel.id, 'windows-system')
  assert.equal(channel.platform, 'win32')
  assert.equal(channel.platformLabel, 'Windows')
  assert.equal(channel.enabled, true)
  assert.equal(channel.sound, false)
  assert.equal(channel.clickUrl, 'https://example.test/open')
  assert.equal(channel.appId, 'Contoso.Notix')
  assert.equal(channel.iconPath, '/tmp/custom.png')

  settings.appId = 'Live.Notix'
  settings.icon = '/tmp/live.png'
  assert.equal(channel.appId, 'Live.Notix')
  assert.equal(channel.iconPath, '/tmp/live.png')
})

test('defaults use the Notix app id, the bundled icon and the shipped helper', () => {
  const channel = new WindowsChannel(() => ({}), silentLogger)
  assert.equal(DEFAULT_APP_ID, 'Notix.DSH')
  assert.equal(APP_DISPLAY_NAME, 'Notix')
  assert.equal(channel.appId, DEFAULT_APP_ID)
  assert.equal(channel.iconPath, bundledIcon)
  assert.equal(channel.iconPath, BUNDLED_ICON)
  assert.equal(existsSync(channel.iconPath), true)
  assert.equal(existsSync(channel.toastScriptPath), true, 'toast.ps1 ships next to the adapter')
  assert.match(channel.toastScriptPath, /toast\.ps1$/)
  assert.equal(channel.sound, true)
  assert.equal(channel.clickUrl, '')
})

test('an invalid app id falls back to the default', () => {
  const invalid = ['', '   ', 'Notix DSH', 'Notix/DSH', '通知', 'a'.repeat(129), 42]
  for (const appId of invalid) {
    const channel = new WindowsChannel(() => config({ appId }), silentLogger)
    assert.equal(channel.appId, DEFAULT_APP_ID, JSON.stringify(appId))
  }
  for (const appId of ['Notix.DSH', '  Contoso.Notix  ', 'my-app_2', '.hidden']) {
    const channel = new WindowsChannel(() => config({ appId }), silentLogger)
    assert.equal(channel.appId, appId.trim())
  }
})

test('toastTag sanitises dedupe keys for toast replacement', () => {
  assert.equal(toastTag('approval:s1:a1'), 'approval_s1_a1')
  assert.equal(toastTag('notix:selftest'), 'notix_selftest')
  assert.equal(toastTag('a.b-c_1'), 'a.b-c_1')
  assert.equal(toastTag('通知'), '__')
  assert.equal(toastTag('   '), '___')
  assert.equal(toastTag('!!!'), '___')
  assert.equal(toastTag(''), undefined)
  assert.equal(toastTag(undefined), undefined)
  assert.equal(toastTag(null), undefined)
  assert.equal(toastTag('a'.repeat(80)), 'a'.repeat(64))
  assert.equal(toastTag(`tag${'x'.repeat(70)}`).length, 64)
})

test('toastEnvironment carries title, body, options and replacement tag', () => {
  const env = toastEnvironment(
    { title: 'Build', body: 'Line one\nLine two', dedupeKey: 'approval:s1:a1' },
    { appId: 'Contoso.Notix', icon: '/tmp/icon.png', sound: true, clickUrl: 'https://example.test/open' },
  )
  assert.equal(env.NOTIX_TITLE, 'Build')
  assert.equal(env.NOTIX_BODY, 'Line one\nLine two')
  assert.equal(env.NOTIX_APP_ID, 'Contoso.Notix')
  assert.equal(env.NOTIX_DISPLAY_NAME, APP_DISPLAY_NAME)
  assert.equal(env.NOTIX_SOUND, '1')
  assert.equal(env.NOTIX_ICON, '/tmp/icon.png')
  assert.equal(env.NOTIX_URL, 'https://example.test/open')
  assert.equal(env.NOTIX_TAG, 'approval_s1_a1')
  assert.equal(env.NOTIX_GROUP, 'notix')
})

test('toastEnvironment omits unset options and defaults the title', () => {
  const env = toastEnvironment(
    { title: 'Notice' },
    { appId: DEFAULT_APP_ID, icon: '', sound: false, clickUrl: '' },
  )
  assert.equal(env.NOTIX_TITLE, 'Notice')
  assert.equal(env.NOTIX_BODY, '')
  assert.equal(env.NOTIX_SOUND, '0')
  assert.equal('NOTIX_ICON' in env, false)
  assert.equal('NOTIX_URL' in env, false)
  assert.equal('NOTIX_TAG' in env, false)
  assert.equal('NOTIX_GROUP' in env, false)

  const fallback = toastEnvironment({}, { appId: DEFAULT_APP_ID, icon: '', sound: true, clickUrl: '' })
  assert.equal(fallback.NOTIX_TITLE, APP_DISPLAY_NAME)
  assert.equal(fallback.NOTIX_BODY, '')
})

test('toastArguments builds a quiet PowerShell script invocation', () => {
  const script = 'C:\\Program Files\\Notix\\toast.ps1'
  assert.deepEqual(toastArguments(script), [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
  ])
})

test('deliver() runs the shipped helper with the payload as environment variables', async () => {
  const { dir, shell } = await fixture()
  try {
    const calls = []
    const channel = new WindowsChannel(
      () =>
        config({
          appId: 'Contoso.Notix',
          icon: join(dir, 'icon.png'),
          clickToOpen: true,
          baseUrl: 'https://example.test/open',
        }),
      silentLogger,
      {
        platform: 'win32',
        powershellPath: shell,
        run: async (file, args, options) => {
          calls.push({ file, args, options })
          return { stdout: '', stderr: '' }
        },
      },
    )
    await channel.send({ title: 'Build', body: 'Done', dedupeKey: 'build:1' })

    assert.equal(calls.length, 1)
    const [call] = calls
    assert.equal(call.file, shell)
    assert.deepEqual(call.args, toastArguments(channel.toastScriptPath))
    assert.deepEqual(call.args.slice(0, 5), [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
    ])
    assert.equal(call.args.at(-1), channel.toastScriptPath)
    assert.equal(call.options.env.NOTIX_TITLE, 'Build')
    assert.equal(call.options.env.NOTIX_BODY, 'Done')
    assert.equal(call.options.env.NOTIX_APP_ID, 'Contoso.Notix')
    assert.equal(call.options.env.NOTIX_DISPLAY_NAME, APP_DISPLAY_NAME)
    assert.equal(call.options.env.NOTIX_SOUND, '1')
    assert.equal(call.options.env.NOTIX_ICON, join(dir, 'icon.png'))
    assert.equal(call.options.env.NOTIX_URL, 'https://example.test/open')
    assert.equal(call.options.env.NOTIX_TAG, 'build_1')
    assert.equal(call.options.env.NOTIX_GROUP, 'notix')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('deliver() uses the configured icon and falls back to the bundled one', async () => {
  const { dir, shell } = await fixture()
  try {
    const captured = []
    const run = async (file, args, options) => {
      captured.push(options.env)
      return { stdout: '', stderr: '' }
    }
    const custom = join(dir, 'custom.png')
    const configured = new WindowsChannel(() => config({ icon: custom }), silentLogger, {
      platform: 'win32',
      powershellPath: shell,
      run,
    })
    await configured.send({ title: 'T', body: 'B' })
    assert.equal(captured[0].NOTIX_ICON, custom)

    const defaulted = new WindowsChannel(() => config({ icon: '   ' }), silentLogger, {
      platform: 'win32',
      powershellPath: shell,
      run,
    })
    await defaulted.send({ title: 'T', body: 'B' })
    assert.equal(captured[1].NOTIX_ICON, BUNDLED_ICON)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('deliver() wraps runner failures with their stderr detail', async () => {
  const { dir, shell } = await fixture()
  try {
    const stderrChannel = new WindowsChannel(() => config(), silentLogger, {
      platform: 'win32',
      powershellPath: shell,
      run: async () => {
        const error = new Error('Command failed')
        error.stderr = '  Access is denied.\n'
        throw error
      },
    })
    await assert.rejects(stderrChannel.send({ title: 'T', body: 'B' }), {
      message: 'notix: Windows toast delivery failed: Access is denied.',
    })

    const messageChannel = new WindowsChannel(() => config(), silentLogger, {
      platform: 'win32',
      powershellPath: shell,
      run: async () => {
        throw new Error('spawn powershell EPERM')
      },
    })
    await assert.rejects(messageChannel.send({ title: 'T', body: 'B' }), {
      message: 'notix: Windows toast delivery failed: spawn powershell EPERM',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('detectBackend() requires both PowerShell and the shipped toast helper', async () => {
  const { dir, shell } = await fixture()
  try {
    const missingShell = new WindowsChannel(() => config(), silentLogger, {
      platform: 'win32',
      powershellPath: join(dir, 'missing-powershell.exe'),
    })
    await assert.rejects(missingShell.detectBackend(), /Windows PowerShell was not found at/)

    const missingHelper = new WindowsChannel(() => config(), silentLogger, {
      platform: 'win32',
      powershellPath: shell,
      toastScript: join(dir, 'missing-toast.ps1'),
    })
    await assert.rejects(missingHelper.detectBackend(), /Windows toast helper is missing at/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('send() rejects on a non-win32 runtime without touching the helper', async () => {
  let ran = false
  const channel = new WindowsChannel(() => config(), silentLogger, {
    platform: 'darwin',
    powershellPath: '/nonexistent/powershell',
    run: async () => {
      ran = true
    },
  })
  assert.equal(channel.supported, false)
  await assert.rejects(channel.send({ title: 'T', body: 'B' }), {
    message: 'windows-system channel is only available on Windows',
  })
  assert.equal(ran, false)
})

test(
  'real end-to-end Windows toast through the shipped PowerShell helper',
  { skip: process.platform !== 'win32' || process.env.NOTIX_TOAST_E2E !== '1' },
  async () => {
    const channel = new WindowsChannel(() => config({ clickToOpen: false, baseUrl: '' }), silentLogger)
    await channel.send({ title: 'Notix test', body: 'Windows toast', dedupeKey: 'test:1' })
  },
)
