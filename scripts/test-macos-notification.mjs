/**
 * Send one real macOS notification through the Notix channel adapter.
 * Useful to verify notification permissions before installing the plugin:
 *   node scripts/test-macos-notification.mjs
 */
import { MacosChannel } from '../packages/notix-dsh/lib/channels/macos.js'

const logger = {
  info: (message) => console.log(`[notix] ${message}`),
  warn: (message) => console.warn(`[notix] ${message}`),
}

const channel = new MacosChannel(
  { enabled: true, sound: true, clickToOpen: false, baseUrl: '' },
  logger,
)
await channel.send({
  title: 'Notix 渠道自检',
  body: '如果你看到这条通知，macOS 通知通道可用。',
  dedupeKey: 'notix:selftest',
})
console.log(`[notix] delivered through ${(await channel.detectHelper()) ?? 'osascript'}`)
