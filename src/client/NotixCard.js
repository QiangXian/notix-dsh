import * as React from 'react'
import {
  CountField,
  MinutesField,
  Section,
  SelectField,
  TextField,
  TimeField,
  ToggleField,
  Trigger,
  useSnapshot,
} from './fields.js'
import { injectStyles } from './styles.js'

const h = React.createElement

/** Schema defaults mirrored so the card also renders partial form snapshots. */
const DEFAULTS = {
  language: 'zh',
  verbosity: 'minimal',
  quietHours: { enabled: false, from: '23:00', to: '08:00', allowUrgent: true },
  triggers: {
    approval: { enabled: true, remindAfterMs: 300_000, maxReminders: 2 },
    userQuestion: { enabled: true, remindAfterMs: 300_000, remindOnContinued: true },
    longTask: { enabled: true, turnThresholdMs: 600_000, jobThresholdMs: 900_000, jobs: false },
    error: { enabled: true, cooldownMs: 60_000, toolErrors: false, toolTimeout: false },
    completion: { enabled: true, minDurationMs: 180_000, jobs: false },
  },
  channels: {
    macos: { enabled: true, sound: true, clickToOpen: true, baseUrl: '' },
    windows: { enabled: true, sound: true, clickToOpen: true, baseUrl: '', appId: '', icon: '' },
  },
}

const TRIGGER_GROUP_KEYS = ['approval', 'userQuestion', 'longTask', 'error', 'completion']

function pick(value, fallback) {
  return value === undefined || value === null ? fallback : value
}

function group(value, fallback) {
  return { ...fallback, ...(value || {}) }
}

/**
 * The notification channel matching the platform the GUI runs on.
 *
 * Detection reads `navigator.userAgent`, falling back to `window.navigator` for
 * renderers that only stub the window object. `navigator` is unavailable in the
 * Node vm the UI tests render in, and unknown user agents carry no platform
 * information, so both fall back to macOS: the card then still renders one
 * complete channel section (without the Windows-only fields) instead of a gap.
 * @returns {'macos' | 'windows'} configuration group name of the channel.
 */
export function detectPlatformChannel() {
  const nav = globalThis.navigator ?? globalThis.window?.navigator
  const userAgent = nav ? String(nav.userAgent ?? '') : ''
  if (/Windows/i.test(userAgent)) return 'windows'
  if (/Mac/i.test(userAgent)) return 'macos'
  return 'macos'
}

/** Read the one-line plugin summary from accepted, persisted form values. */
function summarize(value) {
  const snapshot = value || {}
  const triggers = snapshot.triggers || {}
  const enabledCount = TRIGGER_GROUP_KEYS.filter(
    (key) => group(triggers[key], DEFAULTS.triggers[key]).enabled,
  ).length
  const platform = detectPlatformChannel()

  return {
    enabledCount,
    quietEnabled: group(snapshot.quietHours, DEFAULTS.quietHours).enabled,
    channelEnabled: group((snapshot.channels || {})[platform], DEFAULTS.channels[platform]).enabled,
  }
}

/**
 * Notix settings card used by both `plugins.item` and `settings.plugins.tab`.
 *
 * `notixForm` is deliberately named so it cannot shadow the host's own `form`
 * injection. `view="summary"` renders only the collapsed plugin-list summary.
 */
export function NotixCard(props) {
  const { t } = props
  const form = props.notixForm
  const snap = useSnapshot(form)
  const [pending, setPending] = React.useState(0)
  const [result, setResult] = React.useState('idle')

  React.useEffect(() => {
    injectStyles()
  }, [])

  if (props.view === 'summary') {
    if (snap.status !== 'ready' || snap.value === undefined) return t('description')
    const summary = summarize(snap.value)
    return `${t('summaryTriggers')}: ${summary.enabledCount}/5 · ${t('summaryQuietHours')}: ${summary.quietEnabled ? t('summaryOn') : t('summaryOff')} · ${t('summaryChannel')}: ${summary.channelEnabled ? t('summaryOn') : t('summaryOff')}`
  }

  if (snap.status === 'loading') return h('div', { className: 'notix-card' }, t('loading'))
  if (snap.status === 'unavailable') return h('div', { className: 'notix-card' }, t('unavailable'))

  const value = snap.value || {}
  const writable = snap.writable !== false
  const disabled = pending > 0 || !writable

  const commit = (path, nextValue) => {
    setPending((count) => count + 1)
    Promise.resolve(form.mutate([{ op: 'set', path, value: nextValue }]))
      .then((accepted) => {
        setResult(accepted ? 'saved' : 'failed')
      })
      .catch(() => {
        setResult('failed')
      })
      .finally(() => {
        setPending((count) => count - 1)
      })
  }

  const quiet = group(value.quietHours, DEFAULTS.quietHours)
  const triggers = value.triggers || {}
  const approval = group(triggers.approval, DEFAULTS.triggers.approval)
  const userQuestion = group(triggers.userQuestion, DEFAULTS.triggers.userQuestion)
  const longTask = group(triggers.longTask, DEFAULTS.triggers.longTask)
  const error = group(triggers.error, DEFAULTS.triggers.error)
  const completion = group(triggers.completion, DEFAULTS.triggers.completion)
  const platformChannel = detectPlatformChannel()
  const channel = group((value.channels || {})[platformChannel], DEFAULTS.channels[platformChannel])

  const triggerSection = h(
    Section,
    { title: t('sectionTriggers') },
    h(Trigger, {
      title: t('triggerApproval'),
      hint: t('triggerApprovalHint'),
      checked: approval.enabled,
      disabled,
      onChange: (next) => commit(['triggers', 'approval', 'enabled'], next),
      fields: [
        h(MinutesField, {
          key: 'approval-remind',
          id: 'notix-approval-remind',
          label: t('fieldRemindAfter'),
          invalidLabel: t('invalidNumber'),
          value: approval.remindAfterMs,
          disabled: disabled || !approval.enabled,
          onCommit: (ms) => commit(['triggers', 'approval', 'remindAfterMs'], ms),
        }),
        h(CountField, {
          key: 'approval-max',
          id: 'notix-approval-max',
          label: t('fieldMaxReminders'),
          invalidLabel: t('invalidNumber'),
          value: approval.maxReminders,
          disabled: disabled || !approval.enabled,
          onCommit: (count) => commit(['triggers', 'approval', 'maxReminders'], count),
        }),
      ],
    }),
    h(Trigger, {
      title: t('triggerUserQuestion'),
      hint: t('triggerUserQuestionHint'),
      checked: userQuestion.enabled,
      disabled,
      onChange: (next) => commit(['triggers', 'userQuestion', 'enabled'], next),
      fields: [
        h(MinutesField, {
          key: 'uq-remind',
          id: 'notix-uq-remind',
          label: t('fieldRemindAfter'),
          invalidLabel: t('invalidNumber'),
          value: userQuestion.remindAfterMs,
          disabled: disabled || !userQuestion.enabled,
          onCommit: (ms) => commit(['triggers', 'userQuestion', 'remindAfterMs'], ms),
        }),
        h(ToggleField, {
          key: 'uq-continued',
          label: t('fieldRemindOnContinued'),
          checked: userQuestion.remindOnContinued,
          disabled: disabled || !userQuestion.enabled,
          onChange: (next) => commit(['triggers', 'userQuestion', 'remindOnContinued'], next),
        }),
      ],
    }),
    h(Trigger, {
      title: t('triggerLongTask'),
      hint: t('triggerLongTaskHint'),
      checked: longTask.enabled,
      disabled,
      onChange: (next) => commit(['triggers', 'longTask', 'enabled'], next),
      fields: [
        h(MinutesField, {
          key: 'lt-turn',
          id: 'notix-lt-turn',
          label: t('fieldTurnThreshold'),
          invalidLabel: t('invalidNumber'),
          value: longTask.turnThresholdMs,
          disabled: disabled || !longTask.enabled,
          onCommit: (ms) => commit(['triggers', 'longTask', 'turnThresholdMs'], ms),
        }),
        h(ToggleField, {
          key: 'lt-jobs',
          label: t('fieldLongTaskJobs'),
          checked: longTask.jobs,
          disabled: disabled || !longTask.enabled,
          onChange: (next) => commit(['triggers', 'longTask', 'jobs'], next),
        }),
        h(MinutesField, {
          key: 'lt-job',
          id: 'notix-lt-job',
          label: t('fieldJobThreshold'),
          invalidLabel: t('invalidNumber'),
          value: longTask.jobThresholdMs,
          disabled: disabled || !longTask.enabled || !longTask.jobs,
          onCommit: (ms) => commit(['triggers', 'longTask', 'jobThresholdMs'], ms),
        }),
      ],
    }),
    h(Trigger, {
      title: t('triggerError'),
      hint: t('triggerErrorHint'),
      checked: error.enabled,
      disabled,
      onChange: (next) => commit(['triggers', 'error', 'enabled'], next),
      fields: [
        h(MinutesField, {
          key: 'err-cooldown',
          id: 'notix-err-cooldown',
          label: t('fieldCooldown'),
          invalidLabel: t('invalidNumber'),
          value: error.cooldownMs,
          disabled: disabled || !error.enabled,
          onCommit: (ms) => commit(['triggers', 'error', 'cooldownMs'], ms),
        }),
        h(ToggleField, {
          key: 'err-tool',
          label: t('fieldToolErrors'),
          checked: error.toolErrors,
          disabled: disabled || !error.enabled,
          onChange: (next) => commit(['triggers', 'error', 'toolErrors'], next),
        }),
        h(ToggleField, {
          key: 'err-timeout',
          label: t('fieldToolTimeout'),
          checked: error.toolTimeout,
          disabled: disabled || !error.enabled,
          onChange: (next) => commit(['triggers', 'error', 'toolTimeout'], next),
        }),
      ],
    }),
    h(Trigger, {
      title: t('triggerCompletion'),
      hint: t('triggerCompletionHint'),
      checked: completion.enabled,
      disabled,
      onChange: (next) => commit(['triggers', 'completion', 'enabled'], next),
      fields: [
        h(MinutesField, {
          key: 'cmp-min',
          id: 'notix-cmp-min',
          label: t('fieldMinDuration'),
          invalidLabel: t('invalidNumber'),
          value: completion.minDurationMs,
          disabled: disabled || !completion.enabled,
          onCommit: (ms) => commit(['triggers', 'completion', 'minDurationMs'], ms),
        }),
        h(ToggleField, {
          key: 'cmp-jobs',
          label: t('fieldCompletionJobs'),
          checked: completion.jobs,
          disabled: disabled || !completion.enabled,
          onChange: (next) => commit(['triggers', 'completion', 'jobs'], next),
        }),
      ],
    }),
  )

  const quietHoursSection = h(
    Section,
    { title: t('sectionQuietHours') },
    h(Trigger, {
      title: t('quietEnabled'),
      checked: quiet.enabled,
      disabled,
      onChange: (next) => commit(['quietHours', 'enabled'], next),
      fields: [
        h(TimeField, {
          key: 'qh-from',
          id: 'notix-qh-from',
          label: t('quietFrom'),
          value: quiet.from,
          disabled: disabled || !quiet.enabled,
          onCommit: (next) => commit(['quietHours', 'from'], next),
        }),
        h(TimeField, {
          key: 'qh-to',
          id: 'notix-qh-to',
          label: t('quietTo'),
          value: quiet.to,
          disabled: disabled || !quiet.enabled,
          onCommit: (next) => commit(['quietHours', 'to'], next),
        }),
        h(ToggleField, {
          key: 'qh-urgent',
          label: t('quietAllowUrgent'),
          checked: quiet.allowUrgent,
          disabled: disabled || !quiet.enabled,
          onChange: (next) => commit(['quietHours', 'allowUrgent'], next),
        }),
      ],
    }),
  )

  const contentSection = h(
    Section,
    { title: t('sectionContent') },
    h(
      'div',
      { className: 'notix-fields' },
      h(SelectField, {
        id: 'notix-language',
        label: t('fieldLanguage'),
        value: pick(value.language, DEFAULTS.language),
        disabled,
        options: [
          { value: 'zh', label: t('languageZh') },
          { value: 'en', label: t('languageEn') },
        ],
        onCommit: (next) => commit(['language'], next),
      }),
      h(SelectField, {
        id: 'notix-verbosity',
        label: t('fieldVerbosity'),
        value: pick(value.verbosity, DEFAULTS.verbosity),
        disabled,
        options: [
          { value: 'minimal', label: t('verbosityMinimal') },
          { value: 'normal', label: t('verbosityNormal') },
        ],
        onCommit: (next) => commit(['verbosity'], next),
      }),
    ),
  )

  const channelFields = [
    h(ToggleField, {
      key: 'ch-sound',
      label: t('channelSound'),
      checked: channel.sound,
      disabled: disabled || !channel.enabled,
      onChange: (next) => commit(['channels', platformChannel, 'sound'], next),
    }),
    h(ToggleField, {
      key: 'ch-click',
      label: t('channelClickToOpen'),
      checked: channel.clickToOpen,
      disabled: disabled || !channel.enabled,
      onChange: (next) => commit(['channels', platformChannel, 'clickToOpen'], next),
    }),
    h(TextField, {
      key: 'ch-url',
      id: 'notix-ch-url',
      label: t('channelBaseUrl'),
      hint: t('channelBaseUrlHint'),
      value: channel.baseUrl,
      disabled: disabled || !channel.enabled || !channel.clickToOpen,
      onCommit: (next) => commit(['channels', platformChannel, 'baseUrl'], next),
    }),
  ]

  if (platformChannel === 'windows') {
    // Windows applies the app id and icon to every toast, so these two inputs
    // depend on the channel switch only (unlike the click-to-open URL).
    const brandingDisabled = disabled || !channel.enabled
    channelFields.push(
      h(TextField, {
        key: 'ch-appid',
        id: 'notix-win-appid',
        label: t('channelAppId'),
        hint: t('channelAppIdHint'),
        value: channel.appId,
        disabled: brandingDisabled,
        onCommit: (next) => commit(['channels', 'windows', 'appId'], next),
      }),
      h(TextField, {
        key: 'ch-icon',
        id: 'notix-win-icon',
        label: t('channelIcon'),
        hint: t('channelIconHint'),
        value: channel.icon,
        disabled: brandingDisabled,
        onCommit: (next) => commit(['channels', 'windows', 'icon'], next),
      }),
    )
  }

  const channelSection = h(
    Section,
    { title: t('sectionChannel') },
    h(Trigger, {
      title: platformChannel === 'windows' ? t('channelEnabledWindows') : t('channelEnabledMacos'),
      checked: channel.enabled,
      disabled,
      onChange: (next) => commit(['channels', platformChannel, 'enabled'], next),
      fields: channelFields,
    }),
  )

  const status = h(
    'div',
    { className: 'notix-status', role: 'status', 'aria-live': 'polite' },
    !writable
      ? h('span', null, t('readOnly'))
      : pending > 0
        ? h('span', null, t('saving'))
        : result === 'failed'
          ? h('span', { className: 'notix-status-error', role: 'alert' }, t('saveFailed'))
          : result === 'saved'
            ? h('span', { className: 'notix-status-saved' }, t('saved'))
            : null,
    writable ? h('span', { className: 'notix-status-note' }, t('reloadNote')) : null,
  )

  return h(
    'div',
    { className: 'notix-card' },
    triggerSection,
    quietHoursSection,
    contentSection,
    channelSection,
    status,
  )
}
