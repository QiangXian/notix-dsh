import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = new URL('../', import.meta.url)
const projectPath = fileURLToPath(projectRoot)
const readProjectFile = (path) => readFile(new URL(path, projectRoot), 'utf8')

const CANONICAL_MODULES = [
  'NotixCard.js',
  'fields.js',
  'index.js',
  'locales.js',
  'styles.js',
]

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolute = join(current, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(root, absolute)))
    else if (entry.isFile()) files.push(relative(root, absolute).split(sep).join('/'))
  }
  return files.sort()
}

test('Client source map links every canonical module and embeds its exact content', async () => {
  const map = JSON.parse(await readProjectFile('lib/client.js.map'))
  assert.equal(map.version, 3)
  assert.equal(map.file, 'client.js')
  assert.deepEqual(
    [...map.sources].sort(),
    CANONICAL_MODULES.map((file) => `../src/client/${file}`).sort(),
  )
  assert.equal(map.sourcesContent.length, map.sources.length)

  for (const [index, source] of map.sources.entries()) {
    assert.match(source, /^\.\.\/src\/client\//)
    assert.doesNotMatch(source, /^(?:[a-zA-Z]:[\\/]|[\\/])/, 'source paths must be relative')
    const sourceUrl = new URL(source, new URL('lib/client.js.map', projectRoot))
    assert.equal(map.sourcesContent[index], await readFile(sourceUrl, 'utf8'), source)
  }

  const serialized = JSON.stringify(map)
  assert.equal(serialized.includes(projectPath), false, 'source map must not leak the checkout path')
  assert.equal(serialized.includes('file://'), false, 'source map must use portable URLs')
})

test('every generated Host artifact exactly matches its src/host source', async () => {
  const sourceRoot = fileURLToPath(new URL('src/host/', projectRoot))
  const files = await listFiles(sourceRoot)
  assert.ok(files.length > 0)

  for (const file of files) {
    const [source, generated] = await Promise.all([
      readFile(join(sourceRoot, file)),
      readFile(new URL(`lib/${file}`, projectRoot)),
    ])
    assert.equal(generated.equals(source), true, `lib/${file} must be generated from src/host/${file}`)
  }
})

test('unified build and prepack use a pinned, explicit toolchain', async () => {
  const manifest = JSON.parse(await readProjectFile('package.json'))
  assert.match(manifest.packageManager, /^pnpm@\d+\.\d+\.\d+$/)
  assert.ok(manifest.engines.node)
  assert.match(manifest.devDependencies.tsdown, /^\d+\.\d+\.\d+$/, 'tsdown must be pinned exactly')
  assert.equal(manifest.scripts.build, 'node scripts/build.mjs')
  assert.equal(manifest.scripts['build:check'], 'node scripts/build.mjs --check')
  assert.equal(manifest.scripts.pretest, 'pnpm build')
  assert.equal(manifest.scripts.prepack, 'pnpm build')
  assert.ok(manifest.files.includes('src'))
  assert.ok(manifest.files.includes('tsdown.config.mjs'))
  assert.ok(manifest.files.includes('docs/DEVELOPMENT.md'))

  const gitignore = await readProjectFile('.gitignore')
  assert.match(gitignore, /(?:^|\n)lib\/(?:\n|$)/, 'generated lib/ must be ignored by Git')

  const bundle = await readProjectFile('lib/client.js')
  assert.match(bundle, /^\/\/ Generated from src\/client\/\. Do not edit directly/)
  assert.match(bundle, /\/\/# sourceMappingURL=client\.js\.map\s*$/)
})
