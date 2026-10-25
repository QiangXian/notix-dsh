import { NotixCard } from './NotixCard.js'
import { en, zh } from './locales.js'

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.notix'

/** Host configuration namespace (the Cordis Loader entry id). */
const NOTIX_NS = 'notix'

/** Browser services required by this Client plugin. */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Mount Notix into both settings surfaces while the Host serves its config.
 *
 * The ConfigFormController is captured once. `whileServed` owns each slot's
 * lifecycle, so both registrations disappear when the Host namespace stops
 * being served and can later be mounted again without duplicating slots.
 */
export function apply(ctx) {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'notix-dsh: dictionaries')

  const form = ctx.configForms.get(NOTIX_NS)

  ctx.effect(
    () =>
      ctx.configForms.whileServed([NOTIX_NS], () =>
        ctx.slots.inject('plugins.item', () =>
          ctx.slots.register(
            {
              name: 'plugins.item',
              id: 'notix',
              order: 40,
              label: () => t('title'),
              locale: NS,
              inject: () => ({ notixForm: form }),
            },
            NotixCard,
          ),
        ),
      ),
    'notix-dsh: page',
  )

  ctx.effect(
    () =>
      ctx.configForms.whileServed([NOTIX_NS], () =>
        ctx.slots.inject('settings.plugins.tab', () =>
          ctx.slots.register(
            {
              name: 'settings.plugins.tab',
              id: 'notix',
              order: 30,
              label: () => t('title'),
              locale: NS,
              inject: () => ({ notixForm: form }),
            },
            NotixCard,
          ),
        ),
      ),
    'notix-dsh: settings tab',
  )
}
