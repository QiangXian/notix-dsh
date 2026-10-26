/**
 * Utilities shared by every platform notification channel.
 *
 * A channel is a thin adapter over a platform transport: it reads its live
 * configuration, resolves one delivery backend and hands the rendered
 * notification to it. Everything that is not platform-specific lives in
 * `base.js`; everything that is not channel-specific lives here.
 * @module notix-dsh/channels/shared
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

/** Absolute path of the icon bundled with the package. */
export const BUNDLED_ICON = join(
  findPackageRoot(dirname(fileURLToPath(import.meta.url))),
  'assets',
  'notifier-icon.png',
)

/**
 * Locate package assets from either src/host (development) or lib (built output).
 * @param startDirectory - directory to start walking upwards from.
 */
export function findPackageRoot(startDirectory) {
  let current = startDirectory
  for (;;) {
    if (existsSync(join(current, 'package.json'))) return current
    const parent = dirname(current)
    if (parent === current) throw new Error('notix: cannot locate package.json for a channel resource')
    current = parent
  }
}

/**
 * Run an external notification tool.
 *
 * The console window stays hidden so a delivery never flashes a terminal, the
 * timeout bounds a hung backend below the channel registry's own 10 s budget,
 * and the output buffer is capped because a notification carries no payload
 * worth reading back.
 * @param file - executable path or name.
 * @param args - argument list.
 * @param options - extra `child_process.execFile` options.
 */
export function runTool(file, args, options = {}) {
  return execFileAsync(file, args, {
    windowsHide: true,
    timeout: 8_000,
    maxBuffer: 1024 * 1024,
    ...options,
  })
}
