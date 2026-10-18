/**
 * Schemastery schema for the Loader and for the Settings UI form.
 *
 * Built lazily through `import()` so the plugin degrades gracefully when the
 * schema package cannot be resolved: configuration defaults still apply through
 * `resolveConfig`, and the Settings card reports the form as unavailable.
 * @module notix-dsh/schema
 */

/**
 * Build the plugin configuration schema.
 * @param z - the schemastery namespace (`define`, `object`, ...).
 * @returns a Standard Schema accepted by Cordis and serializable to the Settings UI.
 */
export function buildSchema(z) {
  const channels = z
    .object({
      macos: z
        .object({
          enabled: z.boolean().default(true),
          sound: z.boolean().default(true),
          clickToOpen: z.boolean().default(true),
          baseUrl: z.string().default(''),
          notifierApp: z.string().default(''),
          appIcon: z.string().default(''),
        })
        .default({}),
    })
    .default({})

  const triggers = z
    .object({
      approval: z
        .object({
          enabled: z.boolean().default(true),
          remindAfterMs: z.number().step(1).min(0).default(300_000),
          maxReminders: z.number().step(1).min(0).max(10).default(2),
        })
        .default({}),
      userQuestion: z
        .object({
          enabled: z.boolean().default(true),
          remindAfterMs: z.number().step(1).min(0).default(300_000),
          maxReminders: z.number().step(1).min(0).max(10).default(2),
          remindOnContinued: z.boolean().default(true),
        })
        .default({}),
      longTask: z
        .object({
          enabled: z.boolean().default(true),
          turnThresholdMs: z.number().step(1).min(0).default(600_000),
          jobThresholdMs: z.number().step(1).min(0).default(900_000),
        })
        .default({}),
      error: z
        .object({
          enabled: z.boolean().default(true),
          cooldownMs: z.number().step(1).min(0).default(60_000),
          toolErrors: z.boolean().default(false),
          toolTimeout: z.boolean().default(false),
        })
        .default({}),
      completion: z
        .object({
          enabled: z.boolean().default(true),
          minDurationMs: z.number().step(1).min(0).default(180_000),
          jobs: z.boolean().default(true),
        })
        .default({}),
    })
    .default({})

  return z.object({
    language: z.union(['zh', 'en']).default('zh'),
    verbosity: z.union(['minimal', 'normal']).default('minimal'),
    quietHours: z
      .object({
        enabled: z.boolean().default(false),
        from: z.string().default('23:00'),
        to: z.string().default('08:00'),
        allowUrgent: z.boolean().default(true),
      })
      .default({}),
    triggers,
    channels,
  })
}
