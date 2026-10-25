import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MacosChannel } from '../src/host/channels/macos.js'

const isMac = process.platform === 'darwin'

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'notix-macos-test-'))
  const capture = join(dir, 'capture.bin')
  const bin = join(dir, 'bin')
  await mkdir(bin)
  return { dir, bin, capture }
}

async function executable(path, body) {
  await writeFile(path, `#!/bin/sh\n${body}\n`)
  await chmod(path, 0o755)
}

async function readArgs(capture) {
  if (!existsSync(capture)) return []
  return (await readFile(capture, 'utf8')).split('\0').filter(Boolean)
}

function config(overrides = {}) {
  return {
    enabled: true,
    sound: true,
    clickToOpen: true,
    baseUrl: 'http://127.0.0.1:62200/',
    notifierApp: '/nonexistent/Notix.app',
    appIcon: '',
    ...overrides,
  }
}

test('default icon resolves to package assets from the Host source tree', () => {
  const channel = new MacosChannel(() => config(), {})
  assert.equal(channel.appIconPath, fileURLToPath(new URL('../assets/notifier-icon.png', import.meta.url)))
  assert.equal(existsSync(channel.appIconPath), true)
})

test('helper app takes priority and receives title, body and sound mode', { skip: !isMac }, async () => {
  const { dir, bin, capture } = await fixture()
  try {
    const app = join(dir, 'Notix.app', 'Contents', 'MacOS')
    await mkdir(app, { recursive: true })
    const helper = join(app, 'NotixNotifier')
    await executable(helper, `printf '%s\\0' "$@" > "${capture}"`)
    await executable(join(bin, 'terminal-notifier'), `printf 'unexpected' > "${capture}"`)
    process.env.PATH = `${bin}:/usr/bin:/bin`
    const channel = new MacosChannel(() => config({ notifierApp: join(dir, 'Notix.app') }), {})
    await channel.send({ title: '标题', body: '正文', dedupeKey: 'n:1' })
    assert.deepEqual(await readArgs(capture), ['标题', '正文', 'default'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('terminal-notifier receives icon, sound and click-to-open URL; disabled options are omitted', { skip: !isMac }, async () => {
  const { dir, bin, capture } = await fixture()
  try {
    const icon = join(dir, 'icon.png')
    await writeFile(icon, 'fake')
    await executable(join(bin, 'terminal-notifier'), `printf '%s\\0' "$@" > "${capture}"`)
    process.env.PATH = `${bin}:/usr/bin:/bin`
    const channel = new MacosChannel(() => config({ appIcon: icon }), {})
    await channel.send({ title: 'Build', body: 'Done', dedupeKey: 'n:2' })
    const args = await readArgs(capture)
    assert.equal(args[args.indexOf('-title') + 1], 'Build')
    assert.equal(args[args.indexOf('-message') + 1], 'Done')
    assert.equal(args[args.indexOf('-group') + 1], 'n:2')
    assert.equal(args[args.indexOf('-appIcon') + 1], icon)
    assert.equal(args[args.indexOf('-sound') + 1], 'default')
    assert.equal(args[args.indexOf('-open') + 1], 'http://127.0.0.1:62200/')

    await channel.send({ title: 'Quiet', body: 'Done', dedupeKey: 'n:3' })
    await rm(capture)
    const quiet = new MacosChannel(() => config({ sound: false, clickToOpen: false }), {})
    await quiet.send({ title: 'Quiet', body: 'Done', dedupeKey: 'n:4' })
    const quietArgs = await readArgs(capture)
    assert.equal(quietArgs.includes('-sound'), false)
    assert.equal(quietArgs.includes('-open'), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('osascript fallback passes notification text as separate argv values', { skip: !isMac }, async () => {
  const { dir, bin, capture } = await fixture()
  try {
    await executable(join(bin, 'osascript'), `printf '%s\\0' "$@" > "${capture}"`)
    process.env.PATH = `${bin}:/usr/bin:/bin`
    const channel = new MacosChannel(() => config({ sound: false }), {})
    await channel.send({ title: 'T', body: 'B "quoted"', dedupeKey: 'n:5' })
    const args = await readArgs(capture)
    assert.equal(args.at(-2), 'B "quoted"')
    assert.equal(args.at(-1), 'T')
    assert.equal(args.at(-3), '--')
    assert.match(args[1], /display notification/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a failing selected backend does not silently switch to another backend', { skip: !isMac }, async () => {
  const { dir, bin, capture } = await fixture()
  try {
    const app = join(dir, 'Broken.app', 'Contents', 'MacOS')
    await mkdir(app, { recursive: true })
    await executable(join(app, 'NotixNotifier'), 'exit 2')
    await executable(join(bin, 'terminal-notifier'), `printf 'fallback' > "${capture}"`)
    process.env.PATH = `${bin}:/usr/bin:/bin`
    const channel = new MacosChannel(() => config({ notifierApp: join(dir, 'Broken.app') }), {})
    await assert.rejects(channel.send({ title: 'T', body: 'B', dedupeKey: 'n:6' }), /not authorized/)
    assert.equal(existsSync(capture), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
