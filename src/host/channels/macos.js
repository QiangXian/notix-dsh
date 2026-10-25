/**
 * macOS delivery channel.
 *
 * Three delivery backends, preferred in order:
 * 1. **Notix helper app** (`Notix.app`) — posts through UNUserNotificationCenter
 *    and shows the Notix/whale icon in the banner. macOS only authorizes
 *    code-signed apps, so the helper must be built with a real signing
 *    identity (see `scripts/build-notifier-app.sh`).
 * 2. **terminal-notifier** — shows the bundled whale icon via `-appIcon`.
 * 3. **osascript** — always available, but the banner shows the system Script
 *    Editor icon because `display notification` cannot carry an icon.
 * @module notix-dsh/channels/macos
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)

/** Locate package assets from either src/host (development) or lib (built output). */
function findPackageRoot(startDirectory) {
  let current = startDirectory
  for (;;) {
    if (existsSync(join(current, 'package.json'))) return current
    const parent = dirname(current)
    if (parent === current) throw new Error('notix: cannot locate package.json for the macOS channel')
    current = parent
  }
}

const PACKAGE_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)))
const DEFAULT_APP = join(homedir(), 'Applications', 'Notix.app')
const DEFAULT_APP_ICON = join(PACKAGE_ROOT, 'assets', 'notifier-icon.png')

const WITH_SOUND = `on run argv
  display notification (item 1 of argv) with title (item 2 of argv) sound name "Glass"
end run`

const WITHOUT_SOUND = `on run argv
  display notification (item 1 of argv) with title (item 2 of argv)
end run`

/** macOS notification adapter. */
export class MacosChannel {
  /**
   * @param getConfig - returns the live `channels.macos` configuration.
   * @param logger - plugin logger.
   */
  constructor(getConfig, logger) {
    this.getConfig = getConfig
    this.logger = logger
    /** @type {Promise<{kind: string, executable?: string, tool?: string}>|undefined} */
    this.backend = undefined
  }

  /** The channel id used by configuration and the registry. */
  get id() {
    return 'macos-system'
  }

  /** Path of the helper app bundle. */
  get notifierAppPath() {
    return this.getConfig().notifierApp || DEFAULT_APP
  }

  /** Path of the whale icon handed to terminal-notifier. */
  get appIconPath() {
    return this.getConfig().appIcon || DEFAULT_APP_ICON
  }

  /** Resolve the delivery backend once; unknown tools fall back to osascript. */
  async detectBackend() {
    if (this.backend !== undefined) return this.backend
    this.backend = (async () => {
      const helper = join(this.notifierAppPath, 'Contents', 'MacOS', 'NotixNotifier')
      if (existsSync(helper)) return { kind: 'helper-app', executable: helper }
      for (const tool of ['terminal-notifier', 'alerter']) {
        try {
          await run('which', [tool])
          return { kind: 'tool', tool }
        } catch {
          // not installed; try the next tool
        }
      }
      return { kind: 'osascript' }
    })()
    return this.backend
  }

  /** Notify through the signed helper app. */
  async sendWithHelper(executable, notification, sound) {
    try {
      await run(executable, [notification.title, notification.body, sound ? 'default' : 'silent'])
    } catch (error) {
      if (error?.code === 2) {
        throw new Error(
          'notix: the Notix notification helper is not authorized. Allow "Notix" in ' +
            'System Settings → Notifications, or rebuild the helper with a real code-signing identity ' +
            '(NOTIX_SIGN_IDENTITY=... scripts/build-notifier-app.sh --install).',
        )
      }
      throw error
    }
  }

  /**
   * Deliver one notification through the platform notification center.
   * @param notification - rendered notification.
   */
  async send(notification) {
    if (process.platform !== 'darwin') throw new Error('macos-system channel is only available on macOS')
    const backend = await this.detectBackend()
    const config = this.getConfig()
    const sound = config.sound !== false
    if (backend.kind === 'helper-app') {
      await this.sendWithHelper(backend.executable, notification, sound)
      return
    }
    if (backend.kind === 'tool' && backend.tool === 'terminal-notifier') {
      const args = ['-title', notification.title, '-message', notification.body, '-group', notification.dedupeKey]
      if (existsSync(this.appIconPath)) args.push('-appIcon', this.appIconPath)
      if (sound) args.push('-sound', 'default')
      const url = config.clickToOpen && config.baseUrl ? config.baseUrl : ''
      if (url !== '') args.push('-open', url)
      await run(backend.tool, args)
      return
    }
    if (backend.kind === 'tool' && backend.tool === 'alerter') {
      const args = ['--title', notification.title, '--message', notification.body]
      if (sound) args.push('--sound', 'default')
      await run(backend.tool, args)
      return
    }
    const script = sound ? WITH_SOUND : WITHOUT_SOUND
    await run('osascript', ['-e', script, '--', notification.body, notification.title])
  }
}
