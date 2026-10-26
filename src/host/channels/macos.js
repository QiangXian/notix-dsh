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
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SystemChannel } from './base.js'
import { BUNDLED_ICON } from './shared.js'

const DEFAULT_APP = join(homedir(), 'Applications', 'Notix.app')

const WITH_SOUND = `on run argv
  display notification (item 1 of argv) with title (item 2 of argv) sound name "Glass"
end run`

const WITHOUT_SOUND = `on run argv
  display notification (item 1 of argv) with title (item 2 of argv)
end run`

/** macOS notification adapter. */
export class MacosChannel extends SystemChannel {
  /** The channel id used by configuration and the registry. */
  get id() {
    return 'macos-system'
  }

  /** The platform this adapter serves. */
  get platform() {
    return 'darwin'
  }

  /** Human-readable platform name for the unsupported-platform error. */
  get platformLabel() {
    return 'macOS'
  }

  /** Path of the helper app bundle. */
  get notifierAppPath() {
    return this.config.notifierApp || DEFAULT_APP
  }

  /** Path of the whale icon handed to terminal-notifier. */
  get appIconPath() {
    return this.config.appIcon || BUNDLED_ICON
  }

  /** Resolve the delivery backend once; unknown tools fall back to osascript. */
  async detectBackend() {
    const helper = join(this.notifierAppPath, 'Contents', 'MacOS', 'NotixNotifier')
    if (existsSync(helper)) return { kind: 'helper-app', executable: helper }
    for (const tool of ['terminal-notifier', 'alerter']) {
      try {
        await this.run('which', [tool])
        return { kind: 'tool', tool }
      } catch {
        // not installed; try the next tool
      }
    }
    return { kind: 'osascript' }
  }

  /** Notify through the signed helper app. */
  async sendWithHelper(executable, notification, sound) {
    try {
      await this.run(executable, [notification.title, notification.body, sound ? 'default' : 'silent'])
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
   * Deliver one notification through the macOS notification center.
   * @param backend - resolved delivery backend.
   * @param notification - rendered notification.
   */
  async deliver(backend, notification) {
    const sound = this.sound
    if (backend.kind === 'helper-app') {
      await this.sendWithHelper(backend.executable, notification, sound)
      return
    }
    if (backend.kind === 'tool' && backend.tool === 'terminal-notifier') {
      const args = ['-title', notification.title, '-message', notification.body, '-group', notification.dedupeKey]
      if (existsSync(this.appIconPath)) args.push('-appIcon', this.appIconPath)
      if (sound) args.push('-sound', 'default')
      const url = this.clickUrl
      if (url !== '') args.push('-open', url)
      await this.run(backend.tool, args)
      return
    }
    if (backend.kind === 'tool' && backend.tool === 'alerter') {
      const args = ['--title', notification.title, '--message', notification.body]
      if (sound) args.push('--sound', 'default')
      await this.run(backend.tool, args)
      return
    }
    const script = sound ? WITH_SOUND : WITHOUT_SOUND
    await this.run('osascript', ['-e', script, '--', notification.body, notification.title])
  }
}
