import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const projectRoot = new URL('../', import.meta.url)
const readProjectFile = (path) => readFile(new URL(path, projectRoot), 'utf8')
const manifest = JSON.parse(await readProjectFile('package.json'))

test('manifest exposes Host and Client halves from one package', () => {
  assert.equal(manifest.name, 'notix-dsh')
  assert.equal(manifest.main, 'lib/index.js')
  assert.equal(manifest.exports['.'], './lib/index.js')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-plugin-manager',
  ])
  assert.equal(manifest.icon, './icon.png')
  assert.ok(manifest.files.includes('lib'))
  assert.ok(manifest.files.includes('icon.png'))
  assert.ok(manifest.files.includes('locale'))
})

test('shipped bundle defaults keep background-job notifications opt-in', async () => {
  const patch = await readProjectFile('cordis.patch.yml')
  const completion = patch.slice(patch.indexOf('          completion:'))
  const completionBlock = completion.slice(0, completion.indexOf('        quietHours:'))
  assert.match(completionBlock, /enabled: true/)
  assert.match(completionBlock, /minDurationMs: 180000/)
  assert.match(completionBlock, /jobs: false/)
  const longTaskStart = patch.indexOf('          longTask:')
  const longTaskBlock = patch.slice(longTaskStart, patch.indexOf('          error:', longTaskStart))
  assert.doesNotMatch(longTaskBlock, /jobs: true/)
  assert.match(longTaskBlock, /jobThresholdMs: 900000/)
})

test('bundle has one Loader entry and no legacy UI package references', async () => {
  const [patch, client] = await Promise.all([
    readProjectFile('cordis.patch.yml'),
    readProjectFile('lib/client.js'),
  ])
  const entryIds = [...patch.matchAll(/^\s+- id:\s+(\S+)\s*$/gm)].map((match) => match[1])
  assert.deepEqual(entryIds, ['notix'])
  assert.match(patch, /^\s+name: notix-dsh\s*$/m)
  assert.doesNotMatch(patch, /notix-dsh-ui|ui-notix/)
  assert.match(client, /^\s*id: "notix-dsh",\s*$/m)
  assert.doesNotMatch(client, /notix-dsh-ui/)
})

test('plugin icon is a 1024px RGBA PNG', async () => {
  const icon = await readFile(new URL('icon.png', projectRoot))
  assert.equal(icon.subarray(1, 4).toString(), 'PNG')
  assert.equal(icon.readUInt32BE(16), 1024)
  assert.equal(icon.readUInt32BE(20), 1024)
  assert.equal(icon[24], 8, 'bit depth')
  assert.equal(icon[25], 6, 'RGBA color type')
})
