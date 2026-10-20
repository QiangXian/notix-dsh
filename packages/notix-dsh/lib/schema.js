/**
 * Schemastery schema for the Loader and for the Settings UI form.
 *
 * Every leaf is `.volatile()`: dsh-settings only exposes Config fields whose
 * nearest volatile ancestor marks them live-editable (`volatileForm()` in
 * `dsh-settings`), and the Loader commits volatile-only changes into the
 * running fiber without a remount. Validated volatile leaves are references
 * (`{ get() }`), so runtime code reads them through `readConfig()` in
 * `./config.js`.
 *
 * Built lazily through `import()` so the plugin degrades gracefully when the
 * schema package cannot be resolved: configuration defaults still apply through
 * `resolveConfig`, and the Settings card reports the form as unavailable.
 * @module notix-dsh/schema
 */

/**
 * Build the plugin configuration schema.
 * @param z - the schemastery namespace (`object`, `boolean`, `number`, ...).
 * @returns a Standard Schema accepted by Cordis and serializable to the Settings UI.
 */
export function buildSchema(z) {
  const channels = z
    .object({
      macos: z
        .object({
          enabled: z.boolean().default(true).volatile(),
          sound: z.boolean().default(true).volatile(),
          clickToOpen: z.boolean().default(true).volatile(),
          baseUrl: z.string().default('').volatile(),
          notifierApp: z.string().default('').volatile(),
          appIcon: z.string().default('').volatile(),
        })
        .default({}),
    })
    .default({})

  const triggers = z
    .object({
      approval: z
        .object({
          enabled: z.boolean().default(true).volatile(),
          remindAfterMs: z.number().step(1).min(0).default(300_000).volatile(),
          maxReminders: z.number().step(1).min(0).max(10).default(2).volatile(),
        })
        .default({}),
      userQuestion: z
        .object({
          enabled: z.boolean().default(true).volatile(),
          remindAfterMs: z.number().step(1).min(0).default(300_000).volatile(),
          maxReminders: z.number().step(1).min(0).max(10).default(2).volatile(),
          remindOnContinued: z.boolean().default(true).volatile(),
        })
        .default({}),
      longTask: z
        .object({
          enabled: z.boolean().default(true).volatile(),
          turnThresholdMs: z.number().step(1).min(0).default(600_000).volatile(),
          jobThresholdMs: z.number().step(1).min(0).default(900_000).volatile(),
        })
        .default({}),
      error: z
        .object({
          enabled: z.boolean().default(true).volatile(),
          cooldownMs: z.number().step(1).min(0).default(60_000).volatile(),
          toolErrors: z.boolean().default(false).volatile(),
          toolTimeout: z.boolean().default(false).volatile(),
        })
        .default({}),
      completion: z
        .object({
          enabled: z.boolean().default(true).volatile(),
          minDurationMs: z.number().step(1).min(0).default(180_000).volatile(),
          jobs: z.boolean().default(true).volatile(),
        })
        .default({}),
    })
    .default({})

  return z.object({
    language: z.union(['zh', 'en']).default('zh').volatile(),
    verbosity: z.union(['minimal', 'normal']).default('minimal').volatile(),
    quietHours: z
      .object({
        enabled: z.boolean().default(false).volatile(),
        from: z.string().default('23:00').volatile(),
        to: z.string().default('08:00').volatile(),
        allowUrgent: z.boolean().default(true).volatile(),
      })
      .default({}),
    triggers,
    channels,
  })
}
