/**
 * Notix configuration defaults and normalization.
 *
 * The schemastery schema used by the Loader lives in `lib/schema.js`; this
 * module is dependency-free so the plugin still works when the schema cannot
 * be built (for example a `link:` install that cannot resolve schemastery).
 * @module notix-dsh/config
 */

/** Default configuration, merged under whatever the user provides. */
export const DEFAULTS = Object.freeze({
  language: 'zh',
  verbosity: 'minimal',
  quietHours: Object.freeze({
    enabled: false,
    from: '23:00',
    to: '08:00',
    allowUrgent: true,
  }),
  triggers: Object.freeze({
    approval: Object.freeze({
      enabled: true,
      remindAfterMs: 300_000,
      maxReminders: 2,
    }),
    userQuestion: Object.freeze({
      enabled: true,
      remindAfterMs: 300_000,
      maxReminders: 2,
      remindOnContinued: true,
    }),
    longTask: Object.freeze({
      enabled: true,
      turnThresholdMs: 600_000,
      jobThresholdMs: 900_000,
    }),
    error: Object.freeze({
      enabled: true,
      cooldownMs: 60_000,
      toolErrors: false,
      toolTimeout: false,
    }),
    completion: Object.freeze({
      enabled: true,
      minDurationMs: 180_000,
      jobs: true,
    }),
  }),
  channels: Object.freeze({
    macos: Object.freeze({
      enabled: true,
      sound: true,
      clickToOpen: true,
      baseUrl: '',
      notifierApp: '',
      appIcon: '',
    }),
  }),
})

/** Whether a value is a plain object (not an array or null). */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Deep-merge `override` over `base` without mutating either input. */
function merge(base, override) {
  if (!isPlainObject(base)) return override === undefined ? base : override
  const result = { ...base }
  if (!isPlainObject(override)) return result
  for (const [key, value] of Object.entries(override)) {
    result[key] = isPlainObject(value) && isPlainObject(base[key]) ? merge(base[key], value) : value
  }
  return result
}

/**
 * Normalize untrusted plugin configuration into the resolved shape used at runtime.
 * @param raw - configuration supplied by the Loader (already validated when a schema exists).
 * @returns a fresh configuration object with every default filled in.
 */
export function resolveConfig(raw) {
  return merge(DEFAULTS, raw)
}
