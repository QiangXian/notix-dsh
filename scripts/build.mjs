/**
 * Build every runtime artifact from src/, or verify the existing lib/ tree.
 *
 *   node scripts/build.mjs          # clean and rebuild lib/
 *   node scripts/build.mjs --check  # rebuild in a temp dir and compare
 *
 * Host modules are copied without transformation to preserve their public
 * module boundaries and resource layout. The Client is bundled by tsdown.
 */
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as buildClient } from 'tsdown'
import { CLIENT_OUTPUTS, clientConfig } from '../tsdown.config.mjs'

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url))
const HOST_SOURCE = join(PROJECT_ROOT, 'src', 'host')
const LIB_DIR = join(PROJECT_ROOT, 'lib')
const TEMP_PREFIX = join(tmpdir(), 'notix-build-')

/** List regular files as sorted, POSIX-style paths relative to root. */
async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const absolute = join(current, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, absolute)))
    } else if (entry.isFile()) {
      files.push(relative(root, absolute).split(sep).join('/'))
    } else {
      throw new Error(`Build input/output must not contain symbolic links: ${absolute}`)
    }
  }

  return files.sort()
}

async function expectedOutputFiles() {
  const hostFiles = await listFiles(HOST_SOURCE)
  const collisions = hostFiles.filter((file) => CLIENT_OUTPUTS.includes(file))
  if (collisions.length > 0) {
    throw new Error(`Host and Client output paths collide: ${collisions.join(', ')}`)
  }
  return [...hostFiles, ...CLIENT_OUTPUTS].sort()
}

async function assertExactOutputs(actual, description) {
  const expected = await expectedOutputFiles()
  const missing = expected.filter((file) => !actual.includes(file))
  const unexpected = actual.filter((file) => !expected.includes(file))
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${description} has an unexpected file set.\n` +
        `Missing: ${missing.join(', ') || 'none'}\n` +
        `Unexpected: ${unexpected.join(', ') || 'none'}`,
    )
  }
}

/** Copy Host sources and emit the Client into one output directory. */
async function buildInto(outDir) {
  await mkdir(outDir, { recursive: true })
  for (const entry of await readdir(HOST_SOURCE)) {
    await cp(join(HOST_SOURCE, entry), join(outDir, entry), { recursive: true })
  }
  await buildClient({ ...clientConfig, outDir })
  await assertExactOutputs(await listFiles(outDir), outDir)
}

/** Ensure the clean target is exactly the project's non-symlink lib directory. */
async function assertSafeCleanTarget() {
  if (LIB_DIR !== join(PROJECT_ROOT, 'lib') || PROJECT_ROOT === dirname(PROJECT_ROOT)) {
    throw new Error(`Refusing to clean unexpected build directory: ${LIB_DIR}`)
  }
  try {
    const stat = await lstat(LIB_DIR)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Refusing to clean non-directory or symbolic-link path: ${LIB_DIR}`)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

async function cleanBuild() {
  await assertSafeCleanTarget()
  await rm(LIB_DIR, { recursive: true, force: true })
  await buildInto(LIB_DIR)
  console.log('Built the complete lib/ tree from src/host/ and src/client/.')
}

async function compareWithFreshBuild(outDir) {
  await buildInto(outDir)
  const freshFiles = await listFiles(outDir)
  let currentFiles
  try {
    currentFiles = await listFiles(LIB_DIR)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('lib/ is missing; run `pnpm build` before `pnpm build:check`.')
    throw error
  }

  const mismatches = []
  for (const file of freshFiles.filter((file) => !currentFiles.includes(file))) {
    mismatches.push(`lib/${file} (missing)`)
  }
  for (const file of currentFiles.filter((file) => !freshFiles.includes(file))) {
    mismatches.push(`lib/${file} (unexpected)`)
  }

  for (const file of freshFiles.filter((file) => currentFiles.includes(file))) {
    const [fresh, current] = await Promise.all([
      readFile(join(outDir, file)),
      readFile(join(LIB_DIR, file)),
    ])
    if (!fresh.equals(current)) mismatches.push(`lib/${file}`)
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Generated artifacts are stale or not reproducible: ${mismatches.join(', ')}\n` +
        'Run `pnpm build` to regenerate the complete lib/ tree from src/.',
    )
  }
  console.log('OK the complete lib/ tree is current and byte-for-byte reproducible.')
}

async function main() {
  const args = process.argv.slice(2)
  const check = args.length === 1 && args[0] === '--check'
  if (args.length > 1 || (args.length === 1 && !check)) {
    throw new Error('Usage: node scripts/build.mjs [--check]')
  }

  process.chdir(PROJECT_ROOT)
  if (!check) {
    await cleanBuild()
    return
  }

  const temporaryDir = await mkdtemp(TEMP_PREFIX)
  try {
    await compareWithFreshBuild(temporaryDir)
  } finally {
    if (!temporaryDir.startsWith(TEMP_PREFIX)) {
      throw new Error(`Refusing to clean unexpected build directory: ${temporaryDir}`)
    }
    await rm(temporaryDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
