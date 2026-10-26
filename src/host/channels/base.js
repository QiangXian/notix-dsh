/**
 * Base class for system notification channels.
 *
 * Subclasses supply only what is platform-specific:
 *
 * - `id`, `platform` (a `process.platform` value) and `platformLabel`;
 * - `detectBackend()`, which resolves the transport once and is cached;
 * - `deliver(backend, notification)`, which posts one notification.
 *
 * Configuration handling, sound/click-to-open derivation, the platform guard,
 * process execution and backend caching are shared, so the macOS and Windows
 * adapters stay small and behave identically from the registry's point of view.
 * @module notix-dsh/channels/base
 */
import { runTool } from './shared.js'

/** Base class for a single-platform notification adapter. */
export class SystemChannel {
  /**
   * @param getConfig - returns the live configuration of this platform channel.
   * @param logger - plugin logger.
   * @param options - `{ platform?, run? }` overrides used by tests.
   */
  constructor(getConfig, logger, options = {}) {
    this.getConfig = getConfig
    this.logger = logger
    this.options = options
    /** @type {Promise<unknown>|undefined} Backend resolved once per adapter. */
    this.backend = undefined
  }

  /** Channel id used by the registry and configuration. */
  get id() {
    throw new Error('notix: channel must implement id')
  }

  /** Runtime `process.platform` value this channel serves. */
  get platform() {
    throw new Error('notix: channel must implement platform')
  }

  /** Human-readable platform name used in error messages. */
  get platformLabel() {
    return this.platform
  }

  /** Platform the adapter is running on; overridable so tests can exercise it. */
  get runtimePlatform() {
    return this.options.platform ?? process.platform
  }

  /** Live configuration snapshot. */
  get config() {
    return this.getConfig() ?? {}
  }

  /** Whether the channel is enabled in configuration. */
  get enabled() {
    return this.config.enabled !== false
  }

  /** Whether notifications should play a sound. */
  get sound() {
    return this.config.sound !== false
  }

  /** URL opened by a notification click, or `''` when click-to-open is off. */
  get clickUrl() {
    const { clickToOpen, baseUrl } = this.config
    if (clickToOpen !== true || typeof baseUrl !== 'string') return ''
    return baseUrl.trim()
  }

  /** Whether this adapter can deliver on its runtime platform. */
  get supported() {
    return this.runtimePlatform === this.platform
  }

  /**
   * Run an external tool. Tests inject a fake runner through `options.run`.
   * @param file - executable path or name.
   * @param args - argument list.
   * @param runOptions - extra `execFile` options.
   */
  run(file, args, runOptions) {
    return (this.options.run ?? runTool)(file, args, runOptions)
  }

  /**
   * Resolve the backend once per adapter. A failed detection is not cached so
   * the next delivery retries it instead of failing forever.
   */
  async detectBackendOnce() {
    if (this.backend === undefined) {
      this.backend = Promise.resolve()
        .then(() => this.detectBackend())
        .catch((error) => {
          this.backend = undefined
          throw error
        })
    }
    return this.backend
  }

  /**
   * Deliver one notification through the platform notification center.
   * @param notification - rendered notification.
   */
  async send(notification) {
    if (!this.supported) throw new Error(`${this.id} channel is only available on ${this.platformLabel}`)
    const backend = await this.detectBackendOnce()
    await this.deliver(backend, notification)
  }

  /** Resolve the platform delivery backend. */
  async detectBackend() {
    throw new Error('notix: channel must implement detectBackend()')
  }

  /** Deliver through an already resolved backend. */
  async deliver(_backend, _notification) {
    throw new Error('notix: channel must implement deliver()')
  }
}
