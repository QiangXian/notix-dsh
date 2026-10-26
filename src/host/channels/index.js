/**
 * Built-in channel registry.
 *
 * Each supported platform has exactly one system channel adapter. Only the
 * adapter whose `platform` matches the running `process.platform` (and whose
 * configuration is enabled) is registered, so a shared profile configuration is
 * portable and no channel ever spawns another platform's tooling.
 * @module notix-dsh/channels
 */
import { MacosChannel } from './macos.js'
import { WindowsChannel } from './windows.js'

/**
 * Adapters by `process.platform`. `configKey` names the matching
 * `channels.<configKey>` configuration group.
 */
export const BUILTIN_CHANNELS = Object.freeze({
  darwin: Object.freeze({
    configKey: 'macos',
    label: 'macOS',
    create: (getConfig, logger, options) => new MacosChannel(getConfig, logger, options),
  }),
  win32: Object.freeze({
    configKey: 'windows',
    label: 'Windows',
    create: (getConfig, logger, options) => new WindowsChannel(getConfig, logger, options),
  }),
})

/**
 * The built-in channel entry for one platform.
 * @param platform - a `process.platform` value; defaults to the running one.
 */
export function platformChannel(platform = process.platform) {
  return BUILTIN_CHANNELS[platform]
}

/**
 * Create the adapters configured for one platform.
 * @param resolveChannelConfig - `(configKey) => live channel configuration`.
 * @param logger - plugin logger.
 * @param platform - platform override used by tests.
 * @returns `{ platform, configKey, channels }` where `channels` stays empty for
 *   an unsupported platform or a disabled channel.
 */
export function createPlatformChannels(resolveChannelConfig, logger, platform = process.platform) {
  const entry = platformChannel(platform)
  if (entry === undefined) return { platform, configKey: undefined, channels: [] }
  const configured = resolveChannelConfig(entry.configKey) ?? {}
  if (configured.enabled !== true) return { platform, configKey: entry.configKey, channels: [] }
  return {
    platform,
    configKey: entry.configKey,
    channels: [entry.create(() => resolveChannelConfig(entry.configKey) ?? {}, logger)],
  }
}

export { SystemChannel } from './base.js'
