import * as React from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'

const h = React.createElement
const { Switch } = primitives
const MS_PER_MINUTE = 60_000

/** Subscribe to a ConfigFormController and render its latest snapshot. */
export function useSnapshot(form) {
  const read = () => form?.getSnapshot?.() ?? { status: 'loading' }
  const [snap, setSnap] = React.useState(read)

  React.useEffect(() => {
    if (typeof form?.subscribe !== 'function') return
    return form.subscribe(() => setSnap(read()))
  }, [form])

  return snap
}

/**
 * Keep a field's local draft while it is focused.
 *
 * Host updates are ignored during editing so they do not clobber typing. When
 * the field is not focused, the draft follows the externally accepted value.
 */
function useDraft(display) {
  const [text, setText] = React.useState(display)
  const editing = React.useRef(false)

  React.useEffect(() => {
    if (!editing.current) setText(display)
  }, [display])

  return { text, setText, editing }
}

/** Render a trigger's title, description and master switch. */
function TriggerRow(props) {
  return h(
    'div',
    { className: 'notix-trigger-head' },
    h(
      'div',
      { className: 'notix-trigger-text' },
      h('div', { className: 'notix-trigger-title' }, props.title),
      props.hint ? h('div', { className: 'notix-trigger-hint' }, props.hint) : null,
    ),
    h(Switch, {
      checked: props.checked,
      label: props.title,
      disabled: props.disabled,
      onChange: (next) => props.onChange(next),
    }),
  )
}

/** Render one trigger group and its dependent fields. */
export function Trigger(props) {
  return h(
    'div',
    { className: 'notix-trigger' },
    h(TriggerRow, {
      title: props.title,
      hint: props.hint,
      checked: props.checked,
      disabled: props.disabled,
      onChange: props.onChange,
    }),
    props.fields && props.fields.length > 0
      ? h('div', { className: props.checked ? 'notix-fields' : 'notix-fields notix-fields-disabled' }, props.fields)
      : null,
  )
}

/** Render a secondary boolean setting. */
export function ToggleField(props) {
  return h(
    'div',
    { className: 'notix-field-row' },
    h('span', { className: 'notix-field-label' }, props.label),
    h(Switch, {
      checked: props.checked,
      label: props.label,
      disabled: props.disabled,
      onChange: (next) => props.onChange(next),
    }),
  )
}

/**
 * Generic draft/commit numeric input.
 *
 * `format(value)` controls the displayed text. `parse(text)` returns the value
 * to commit, or null when the draft is invalid. Values commit on blur/Enter.
 */
function NumberField(props) {
  const display = props.format(props.value)
  const draft = useDraft(display)
  const [invalid, setInvalid] = React.useState(false)
  const messageId = `${props.id}-message`

  const commitText = () => {
    const parsed = props.parse(draft.text)
    if (parsed === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    draft.setText(props.format(parsed))
    if (parsed !== props.value) props.onCommit(parsed)
  }

  return h(
    'div',
    { className: 'notix-field' },
    h(
      'label',
      { className: 'notix-field-row', htmlFor: props.id },
      h('span', { className: 'notix-field-label' }, props.label),
      h('input', {
        id: props.id,
        className: 'notix-input notix-input-num',
        type: 'text',
        inputMode: props.integer ? 'numeric' : 'decimal',
        disabled: props.disabled,
        value: draft.text,
        'aria-label': props.label,
        ...(invalid ? { 'aria-invalid': true, 'aria-describedby': messageId } : {}),
        onFocus: () => {
          draft.editing.current = true
        },
        onChange: (event) => {
          setInvalid(false)
          draft.setText(event.target.value)
        },
        onBlur: () => {
          draft.editing.current = false
          commitText()
        },
        onKeyDown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitText()
            if (props.parse(draft.text) !== null) event.target.blur()
          }
        },
      }),
    ),
    invalid
      ? h('p', { id: messageId, className: 'notix-field-message notix-field-error', role: 'alert' }, props.invalidLabel)
      : props.hint
        ? h('p', { className: 'notix-field-message notix-field-hint' }, props.hint)
        : null,
  )
}

/** Edit a millisecond duration as minutes. */
export function MinutesField(props) {
  return h(NumberField, {
    ...props,
    format: (ms) => String(Math.round((ms / MS_PER_MINUTE) * 100) / 100),
    parse: (text) => {
      const n = Number(text)
      if (!Number.isFinite(n) || n < 0) return null
      return Math.round(n * MS_PER_MINUTE)
    },
  })
}

/** Edit an integer counter such as maxReminders (0–10). */
export function CountField(props) {
  return h(NumberField, {
    ...props,
    integer: true,
    format: (n) => String(n),
    parse: (text) => {
      const n = Number(text)
      if (!Number.isFinite(n)) return null
      const r = Math.round(n)
      if (r < 0 || r > 10) return null
      return r
    },
  })
}

/** Edit an HH:MM time-of-day value. */
export function TimeField(props) {
  return h(
    'label',
    { className: 'notix-field-row', htmlFor: props.id },
    h('span', { className: 'notix-field-label' }, props.label),
    h('input', {
      id: props.id,
      className: 'notix-input notix-input-time',
      type: 'time',
      disabled: props.disabled,
      value: props.value,
      'aria-label': props.label,
      onChange: (event) => {
        const value = event.target.value
        if (/^\d{2}:\d{2}$/.test(value)) props.onCommit(value)
      },
    }),
  )
}

/** Edit an enumerated value. */
export function SelectField(props) {
  return h(
    'label',
    { className: 'notix-field-row', htmlFor: props.id },
    h('span', { className: 'notix-field-label' }, props.label),
    h(
      'select',
      {
        id: props.id,
        className: 'notix-input notix-input-select',
        disabled: props.disabled,
        value: props.value,
        'aria-label': props.label,
        onChange: (event) => props.onCommit(event.target.value),
      },
      props.options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
    ),
  )
}

/** Edit free text, committing on blur or Enter. */
export function TextField(props) {
  const draft = useDraft(props.value)

  const commitText = () => {
    if (draft.text !== props.value) props.onCommit(draft.text)
  }

  return h(
    'div',
    { className: 'notix-field' },
    h(
      'label',
      { className: 'notix-field-row', htmlFor: props.id },
      h('span', { className: 'notix-field-label' }, props.label),
      h('input', {
        id: props.id,
        className: 'notix-input notix-input-text',
        type: 'text',
        disabled: props.disabled,
        value: draft.text,
        placeholder: props.placeholder,
        'aria-label': props.label,
        onFocus: () => {
          draft.editing.current = true
        },
        onChange: (event) => draft.setText(event.target.value),
        onBlur: () => {
          draft.editing.current = false
          commitText()
        },
        onKeyDown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitText()
            event.target.blur()
          }
        },
      }),
    ),
    props.hint ? h('p', { className: 'notix-field-message notix-field-hint' }, props.hint) : null,
  )
}

/** Render a titled settings section. */
export function Section(props) {
  return h(
    'section',
    { className: 'notix-section' },
    h('h3', { className: 'notix-section-title' }, props.title),
    h('div', { className: 'notix-group' }, props.children),
  )
}
