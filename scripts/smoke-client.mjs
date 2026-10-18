/**
 * Smoke-test a dsh client plugin bundle without a browser.
 *
 * Evaluates `lib/client.js` in a VM with a stubbed `window.__ModuleLoader__`
 * and a stub `require`, then asserts the bundle registers the expected plugin
 * id and exposes `apply`/`inject`. This catches syntax errors, missing module
 * ids, and factory-shape regressions — not rendering behavior.
 *
 *   node scripts/smoke-client.mjs [path/to/lib/client.js] [expectedId]
 */
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const clientPath = process.argv[2] ?? 'packages/notix-dsh-ui/lib/client.js'
const expectedId = process.argv[3] ?? 'notix-dsh-ui'
const source = await readFile(clientPath, 'utf8')

const reactStub = {
  createElement: () => null,
  Fragment: {},
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
}
const jsxStub = {
  jsx: () => null,
  jsxs: () => null,
  Fragment: {},
}
const primitivesStub = new Proxy(
  {},
  {
    get(_target, property) {
      if (property === 'Switch' || property === 'Toast') return () => null
      if (property === 'SettingsFormModel') return class {}
      if (typeof property === 'string' && property.endsWith('Field')) return () => ({ name: property })
      return () => null
    },
  },
)
const storeStub = {
  createSnapshotStore: (initial) => {
    let snapshot = initial
    const listeners = new Set()
    return {
      getSnapshot: () => snapshot,
      set: (next) => {
        snapshot = next
        for (const listener of listeners) listener(snapshot)
      },
      update: (fn) => {
        snapshot = fn(snapshot)
        for (const listener of listeners) listener(snapshot)
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
  },
}

const modules = new Map([
  ['react', reactStub],
  ['react/jsx-runtime', jsxStub],
  ['@deepseek-ai/dsh-client-ui-primitives', primitivesStub],
  ['@deepseek-ai/dsh-client-store', storeStub],
])

const requireStub = (id) => {
  if (!modules.has(id)) throw new Error(`client bundle requires an unavailable module: ${id}`)
  return modules.get(id)
}

let registered
const window = {
  __ModuleLoader__: {
    load(entry) {
      if (registered !== undefined) throw new Error('bundle registered more than one module')
      registered = entry
    },
  },
}

vm.runInNewContext(source, { window, console, setTimeout, clearTimeout })

if (registered === undefined) throw new Error('bundle did not call window.__ModuleLoader__.load')
if (registered.id !== expectedId) throw new Error(`expected module id ${expectedId}, got ${registered.id}`)
const exported = registered.factory(requireStub)
if (typeof exported.apply !== 'function') throw new Error('client module does not export apply()')
if (!Array.isArray(exported.inject)) throw new Error('client module does not export an inject array')
console.log(`OK ${clientPath}: id=${registered.id} apply=function inject=[${exported.inject.join(', ')}]`)
