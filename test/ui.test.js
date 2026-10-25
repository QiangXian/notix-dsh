import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

/** Load the browser bundle with the same module-loader contract DSH uses. */
async function loadClient() {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: {},
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
  }
  const primitives = { Switch: () => null }
  const modules = new Map([
    ['react', react],
    ['@deepseek-ai/dsh-client-ui-primitives', primitives],
  ])
  let registered
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (entry) => { registered = entry } } },
    console,
    setTimeout,
    clearTimeout,
  })
  return registered.factory((id) => {
    if (!modules.has(id)) throw new Error(`unexpected module: ${id}`)
    return modules.get(id)
  })
}

/** Collect every createElement node in a rendered tree. */
function nodes(node, result = []) {
  if (node === null || node === undefined || typeof node !== 'object') return result
  if (Array.isArray(node)) {
    for (const child of node) nodes(child, result)
    return result
  }
  if ('type' in node) {
    result.push(node)
    nodes(node.children, result)
    // Some components receive renderable fields through props (for example a
    // trigger group's `fields` array), so traverse those containers too.
    for (const value of Object.values(node.props)) if (Array.isArray(value)) nodes(value, result)
  }
  return result
}

function fakeForm(value = {}) {
  const snapshot = { status: 'ready', value, writable: true }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async () => true,
  }
}

/** Install the client plugin into a minimal slots/configForms context. */
function install(form) {
  const pages = []
  const ctx = {
    locale: { bind: () => (key) => key, register: () => () => {} },
    configForms: { get: () => form, whileServed: (_names, fn) => fn() },
    slots: {
      inject: (_slot, fn) => fn(),
      register: (spec, component) => {
        pages.push({ spec, component })
        return () => {}
      },
    },
    effect: (fn) => {
      const disposer = fn()
      return () => disposer?.()
    },
  }
  return { ctx, pages }
}

test('settings card receives its config form under a non-colliding injection name', async () => {
  const client = await loadClient()
  const form = fakeForm()
  const { ctx, pages } = install(form)
  client.apply(ctx)

  assert.equal(pages.length, 2, 'registers both the Plugins and Settings cards')
  assert.deepEqual(pages.map((page) => page.spec.name), ['plugins.item', 'settings.plugins.tab'])
  for (const page of pages) {
    const injected = page.spec.inject()
    assert.equal(injected.notixForm, form)
    assert.equal('form' in injected, false, 'must not shadow host-provided form props')
  }
})

test('full settings card renders all sections without duplicating the summary', async () => {
  const client = await loadClient()
  const form = fakeForm({})
  const { ctx, pages } = install(form)
  client.apply(ctx)

  const tree = pages[0].component({ notixForm: form, t: (key) => key })
  const rendered = nodes(tree)
  assert.ok(rendered.some((node) => node.props.className === 'notix-card'))
  assert.equal(rendered.some((node) => node.props.className === 'notix-summary'), false)
  assert.ok(rendered.some((node) => node.props.id === 'notix-approval-remind'))
  assert.ok(rendered.some((node) => node.props.id === 'notix-ch-url'))
  assert.equal(rendered.some((node) => node.props.id === 'notix-test'), false)
  assert.equal(JSON.stringify(tree).includes('testNotify'), false)
  const labels = rendered.map((node) => node.props.label).filter((label) => typeof label === 'string')
  assert.ok(labels.includes('fieldLongTaskJobs'))
  assert.ok(labels.includes('fieldCompletionJobs'))
  assert.equal(labels.filter((label) => label === 'fieldJobs').length, 0)
})

test('URL field is disabled when click-to-open is off', async () => {
  const client = await loadClient()
  const form = fakeForm({ channels: { macos: { enabled: true, clickToOpen: false, baseUrl: '' } } })
  const { ctx, pages } = install(form)
  client.apply(ctx)

  const tree = pages[0].component({ notixForm: form, t: (key) => key })
  const url = nodes(tree).find((node) => node.props.id === 'notix-ch-url')
  assert.ok(url)
  assert.equal(url.props.disabled, true)
})

test('summary view still renders with a ready form', async () => {
  const client = await loadClient()
  const form = fakeForm({})
  const { ctx, pages } = install(form)
  client.apply(ctx)

  const summary = pages[0].component({ notixForm: form, t: (key) => key, view: 'summary' })
  assert.match(summary, /summaryTriggers: 5\/5/)
})

test('missing form degrades to the loading state instead of crashing', async () => {
  const client = await loadClient()
  const { ctx, pages } = install(undefined)
  client.apply(ctx)

  const tree = pages[0].component({ t: (key) => key })
  assert.equal(tree.props.className, 'notix-card')
  assert.deepEqual(tree.children, ['loading'])
})
