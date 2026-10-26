/**
 * Windows delivery channel.
 *
 * Windows has no shell command equivalent to macOS `osascript` that produces a
 * real Action Center toast, so delivery goes through the bundled PowerShell
 * helper (`toast.ps1`), which posts a WinRT `ToastNotification`. That helper
 * also registers a per-user `AppUserModelId`, so Windows attributes the banner
 * to **Notix** and shows the bundled whale icon instead of the PowerShell host.
 *
 * The payload travels as `NOTIX_*` environment variables rather than command
 * line arguments: titles and bodies are user content and never need quoting,
 * and `toast.ps1` escapes them for the toast XML itself.
 * @module notix-dsh/channels/windows
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SystemChannel } from './base.js'
import { BUNDLED_ICON } from './shared.js'

/** Default per-user application id registered for the toast banner. */
export const DEFAULT_APP_ID = 'Notix.DSH'

/** Application name Windows shows on the banner and in notification settings. */
export const APP_DISPLAY_NAME = 'Notix'

/** The helper that posts one toast; shipped next to this module in src/ and lib/. */
const TOAST_SCRIPT = fileURLToPath(new URL('./toast.ps1', import.meta.url))

/** Arguments that turn `powershell.exe` into a quiet, policy-independent script host. */
const POWERSHELL_ARGUMENTS = Object.freeze([
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
])

/** An AppUserModelId is a registry key name: keep it predictable and safe. */
const APP_ID_PATTERN = /^[\w.-]{1,128}$/

/** Toast tags replace an earlier notification with the same tag (max 64 chars). */
const MAX_TAG_LENGTH = 64

/**
 * Locate Windows PowerShell 5.1, whose WinRT projection the helper needs.
 * @param override - explicit path from configuration or tests.
 */
function powershellExecutable(override) {
  if (typeof override === 'string' && override !== '') return override
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/**
 * Sanitize a dedupe key into a valid toast replacement tag.
 * @param dedupeKey - notification dedupe key.
 * @returns the tag, or undefined when there is nothing to derive.
 */
export function toastTag(dedupeKey) {
  const tag = String(dedupeKey ?? '')
    .replace(/[^\w.-]/g, '_')
    .slice(0, MAX_TAG_LENGTH)
  return tag === '' ? undefined : tag
}

/**
 * Build the `powershell.exe` argument list that runs the helper.
 * @param scriptPath - absolute path of the shipped helper.
 */
export function toastArguments(scriptPath) {
  return [...POWERSHELL_ARGUMENTS, scriptPath]
}

/**
 * Build the helper environment; exported so it is unit-testable on every OS.
 * @param notification - rendered notification.
 * @param options - `{ appId, icon, sound, clickUrl }` resolved from configuration.
 */
export function toastEnvironment(notification, options) {
  const env = {
    ...process.env,
    NOTIX_TITLE: notification.title ?? APP_DISPLAY_NAME,
    NOTIX_BODY: notification.body ?? '',
    NOTIX_APP_ID: options.appId,
    NOTIX_DISPLAY_NAME: APP_DISPLAY_NAME,
    NOTIX_SOUND: options.sound ? '1' : '0',
  }
  if (typeof options.icon === 'string' && options.icon !== '') env.NOTIX_ICON = options.icon
  if (typeof options.clickUrl === 'string' && options.clickUrl !== '') env.NOTIX_URL = options.clickUrl
  const tag = toastTag(notification.dedupeKey)
  if (tag !== undefined) {
    env.NOTIX_TAG = tag
    env.NOTIX_GROUP = 'notix'
  }
  return env
}

/** Windows notification adapter. */
export class WindowsChannel extends SystemChannel {
  /** The channel id used by configuration and the registry. */
  get id() {
    return 'windows-system'
  }

  /** The platform this adapter serves. */
  get platform() {
    return 'win32'
  }

  /** Human-readable platform name for the unsupported-platform error. */
  get platformLabel() {
    return 'Windows'
  }

  /** The shipped PowerShell toast helper. */
  get toastScriptPath() {
    return this.options.toastScript ?? TOAST_SCRIPT
  }

  /** PowerShell executable used for delivery; overridable for tests. */
  get executablePath() {
    return powershellExecutable(this.options.powershellPath)
  }

  /** Application id / AUMID used for the toast banner. */
  get appId() {
    const configured = typeof this.config.appId === 'string' ? this.config.appId.trim() : ''
    return APP_ID_PATTERN.test(configured) ? configured : DEFAULT_APP_ID
  }

  /** Icon shown in the toast. */
  get iconPath() {
    const configured = typeof this.config.icon === 'string' ? this.config.icon.trim() : ''
    return configured !== '' ? configured : BUNDLED_ICON
  }

  /** Resolve the PowerShell backend once. */
  async detectBackend() {
    const executable = this.executablePath
    if (!existsSync(executable)) {
      throw new Error(`notix: Windows PowerShell was not found at ${executable}`)
    }
    if (!existsSync(this.toastScriptPath)) {
      throw new Error(`notix: the Windows toast helper is missing at ${this.toastScriptPath}`)
    }
    return { kind: 'powershell-toast', executable }
  }

  /**
   * Deliver one notification through a WinRT toast.
   * @param backend - resolved delivery backend.
   * @param notification - rendered notification.
   */
  async deliver(backend, notification) {
    const env = toastEnvironment(notification, {
      appId: this.appId,
      icon: this.iconPath,
      sound: this.sound,
      clickUrl: this.clickUrl,
    })
    try {
      await this.run(backend.executable, toastArguments(this.toastScriptPath), { env })
    } catch (error) {
      const detail = String(error?.stderr ?? '').trim() || String(error?.message ?? error)
      throw new Error(`notix: Windows toast delivery failed: ${detail}`)
    }
  }
}
