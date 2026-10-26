/**
 * Send one real Windows notification through the Notix channel adapter.
 * Useful to verify WinRT toast delivery before installing the plugin:
 *   node scripts/test-windows-notification.mjs [--no-sound] [--no-click]
 *
 * Prefers the built channel in lib/ and falls back to the Host source tree so
 * the script also works before the first build.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const builtModule = new URL('../lib/channels/windows.js', import.meta.url)
const sourceModule = new URL('../src/host/channels/windows.js', import.meta.url)
const moduleUrl = existsSync(fileURLToPath(builtModule)) ? builtModule : sourceModule
const { WindowsChannel } = await import(moduleUrl.href)

const flags = new Set(process.argv.slice(2))
const logger = {
  info: (message) => console.log(`[notix] ${message}`),
  warn: (message) => console.warn(`[notix] ${message}`),
}

if (process.platform !== 'win32') {
  console.error(`[notix] the Windows toast channel only runs on Windows (this is ${process.platform})`)
  process.exitCode = 1
} else {
  const config = {
    enabled: true,
    sound: !flags.has('--no-sound'),
    clickToOpen: !flags.has('--no-click'),
    baseUrl: '',
    appId: '',
    icon: '',
  }
  const channel = new WindowsChannel(() => config, logger)
  try {
    const backend = await channel.detectBackend()
    await channel.send({
      title: 'Notix Windows 渠道自检',
      body: '如果你看到这条通知，Windows 通知通道可用。',
      dedupeKey: 'notix:selftest:win',
    })
    console.log(`[notix] delivered through ${backend.kind} (${backend.executable})`)
  } catch (error) {
    console.error(`[notix] Windows notification test failed: ${error?.message ?? error}`)
    process.exitCode = 1
  }
}
