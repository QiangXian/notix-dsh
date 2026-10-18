/**
 * Notix — user notifications for DeepSeek Harness.
 *
 * Pure observer: the plugin never registers an answerer and never appends
 * session events. It watches approvals, pending questions, long turns/jobs,
 * terminal errors, and completions, then delivers notifications through its
 * channel registry (macOS system notification in v1).
 * @module notix-dsh
 */
import { resolveConfig } from './config.js'
import { buildSchema } from './schema.js'
import { NotixCore } from './core/notix.js'
import { installTriggers } from './triggers/index.js'

/** Cordis plugin name. */
export const name = 'notix'

/** Services required before the plugin can start observing. */
export const inject = ['sessions', 'timer', 'sessionProjections']

/**
 * Loader schema, built opportunistically: when the schema package cannot be
 * resolved the plugin still runs with `resolveConfig` defaults, but the
 * Settings card reports the form as unavailable.
 */
let Config
try {
  const { default: z } = await import('@deepseek-ai/schemastery')
  Config = buildSchema(z)
} catch {
  Config = undefined
}
export { Config }

/** Create the plugin logger without assuming a particular logger shape. */
function createLogger(ctx) {
  try {
    const logger = ctx.logger('notix')
    if (logger !== undefined && typeof logger.warn === 'function') return logger
  } catch {
    // fall through to a console-backed logger
  }
  return {
    info: (message) => console.log(`[notix] ${message}`),
    warn: (message) => console.warn(`[notix] ${message}`),
    debug: () => {},
  }
}

/**
 * Install Notix on the given context.
 * @param ctx - plugin context.
 * @param rawConfig - Loader-validated configuration.
 */
export async function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const logger = createLogger(ctx)
  const core = new NotixCore(ctx, config, logger)
  await core.start()
  installTriggers(ctx, core)
  ctx.provide('notix', core.api())
  ctx.effect(() => () => core.dispose(), 'notix: dispose')
  logger.info('notix: watching approvals, questions, long tasks, errors, and completions')
}
