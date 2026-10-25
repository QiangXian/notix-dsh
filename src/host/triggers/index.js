/**
 * Trigger installation: every trigger is a read-only observer on the shared
 * event surfaces. Listing order only affects which completion consumer sees a
 * turn's start time first; each trigger owns disjoint state.
 * @module notix-dsh/triggers
 */
import { installApproval } from './approval.js'
import { installQuestions } from './questions.js'
import { installLongTask } from './long-task.js'
import { installError } from './error.js'
import { installCompletion } from './completion.js'

/**
 * Install all triggers on the plugin fiber.
 * @param ctx - plugin context.
 * @param core - notification pipeline.
 */
export function installTriggers(ctx, core) {
  installApproval(ctx, core)
  installQuestions(ctx, core)
  installLongTask(ctx, core)
  installError(ctx, core)
  installCompletion(ctx, core)
}
