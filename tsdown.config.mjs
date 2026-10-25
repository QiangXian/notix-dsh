import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = fileURLToPath(new URL('./', import.meta.url))
const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/** Runtime modules supplied by DSH's module table, never bundled into Notix. */
const CLIENT_EXTERNALS = new Set(['react', '@deepseek-ai/dsh-client-ui-primitives'])

export const CLIENT_OUTPUTS = ['client.js', 'client.js.map']

/**
 * Keep source-map paths stable even when build:check emits into a temp dir.
 * The returned paths resolve from lib/ back to the canonical src/ tree, while
 * sourcesContent makes browser debugging independent of that tree being served.
 */
function sourcemapPathTransform(source, mapPath) {
  const absoluteSource = resolve(dirname(mapPath), source)
  const projectPath = relative(PROJECT_ROOT, absoluteSource)
  if (projectPath === '' || projectPath.startsWith(`..${sep}`) || isAbsolute(projectPath)) {
    throw new Error(`Client source map input escapes the project: ${source}`)
  }
  return `../${projectPath.split(sep).join('/')}`
}

/**
 * DSH Client bundle contract.
 *
 * The wrapper and map are emitted in the same tsdown pass. React and DSH UI
 * primitives stay external and are resolved by the injected factory require;
 * every other dependency must be bundled explicitly rather than left as an
 * unknown browser require.
 */
export const clientConfig = {
  name: 'notix-dsh/client',
  entry: { client: 'src/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  fixedExtension: false,
  minify: false,
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    neverBundle: (specifier) => CLIENT_EXTERNALS.has(specifier),
    alwaysBundle: (specifier) => !CLIENT_EXTERNALS.has(specifier),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    chunkFileNames: 'client.[name].js',
    sourcemapExcludeSources: false,
    sourcemapPathTransform,
    banner: `// Generated from src/client/. Do not edit directly; run pnpm build instead.\nwindow.__ModuleLoader__.load({\n  id: ${JSON.stringify(manifest.name)},\n  factory: (require) => {`,
    intro: 'var module = { exports: {} };\nvar exports = module.exports;',
    footer: 'return module.exports;\n}\n});',
  },
}

export default clientConfig
