# Notix development guide

Notix has one directory rule: **`src/` contains every hand-written source file; `lib/` contains only generated runtime artifacts.**

## Source of truth

```text
src/
  host/                 Node/Host source, loaded by Cordis after being copied to lib/
    index.js
    config.js
    schema.js
    core/
    channels/
    triggers/
  client/               Browser Client source
    index.js            DSH services and slot lifecycle
    NotixCard.js        Settings-card composition and ConfigForm mutations
    fields.js           Form hooks and reusable controls
    locales.js          Browser UI dictionaries
    styles.js           Theme-aware styles and injection

lib/                    Generated in full; never edit or commit this directory
  index.js              Host entry copied from src/host/index.js
  core/                 Host modules copied from src/host/core/
  channels/             Host modules copied from src/host/channels/
  triggers/             Host modules copied from src/host/triggers/
  client.js             Browser factory bundle emitted by tsdown
  client.js.map         Client source map emitted by tsdown
```

`lib/` is listed in `.gitignore`. A clean checkout therefore starts without runtime artifacts; the build, test and packaging commands create them as needed. The npm allowlist includes both `src/` and the generated `lib/`, so published packages remain runnable and inspectable. If an existing repository already tracks `lib/`, remove it from the Git index once with `git rm -r --cached lib` after moving the sources; `.gitignore` alone does not untrack earlier artifacts.

## Build architecture

`node scripts/build.mjs` performs one complete build:

1. Verify that the clean target is exactly the project's non-symlink `lib/` directory.
2. Remove and recreate `lib/`.
3. Copy `src/host/` into `lib/` without transforming the JavaScript.
4. Bundle `src/client/index.js` into `lib/client.js` and emit `lib/client.js.map` with tsdown.
5. Reject missing or additional files, including accidental Client chunks.

Host files are copied rather than bundled so their module boundaries, relative imports and stack locations stay intact. The copies are byte-for-byte identical to their sources. Client code is bundled because DSH expects one classic-script factory artifact.

Host resource lookup must work from both `src/host/` and `lib/`. Locate package-level resources through the nearest `package.json`, as in `src/host/channels/macos.js`, rather than assuming a fixed directory depth.

## Toolchain

- Node.js follows `engines.node` in `package.json`.
- pnpm is pinned by `packageManager`; dependency resolution is locked by `pnpm-lock.yaml`.
- `tsdown` is pinned to an exact version in `devDependencies`.
- `tsdown.config.mjs` is plain JavaScript, so no TypeScript config loader is required.

Install from a clean checkout with:

```bash
pnpm install --frozen-lockfile
pnpm build
```

## Daily commands

```bash
# Clean and rebuild the complete lib/ tree from src/.
pnpm build

# Build into a temporary directory and compare every generated file with lib/.
# This catches stale files, content drift, missing files and extra chunks.
pnpm build:check

# Automatically runs pretest -> build, then all unit/integration/package tests.
pnpm test

# Execute the generated Client against a stub DSH module loader.
pnpm smoke

# Complete local gate: build + tests + smoke + full-tree reproducibility check.
pnpm verify
```

`prepack` runs `pnpm build`, so `npm pack` and `npm publish` also work from a checkout where `lib/` does not exist. `build:check` never writes into the project and does not depend on Git metadata.

## DSH Client module boundary

The generated Client is a classic script, not an ES module. It registers exactly one `window.__ModuleLoader__.load({ id, factory })` entry. The factory synchronously returns `module.exports` with `NS`, `apply`, and `inject`.

Only these bare imports currently remain external:

- `react`
- `@deepseek-ai/dsh-client-ui-primitives`

They are resolved by the `require` injected by DSH. Do not bundle another copy of React, leave an unknown bare `require()`, or import Node builtins into Client code. Adding a new external requires an intentional DSH module-table contract and corresponding loader/UI tests; ordinary additional libraries should be bundled deliberately.

Keep a single Client output chunk. Do not introduce code splitting or dynamic bare-package imports without first defining how the DSH loader will resolve them. `build:check` rejects additional emitted files.

## Source maps

`lib/client.js.map` is emitted in the same tsdown pass as the factory wrapper, so banner/footer lines cannot invalidate its mappings. It contains `sourcesContent` for every canonical Client module and uses portable relative paths such as `../src/client/index.js`.

Build-contract tests verify that:

- every canonical Client module appears in the map with its exact source content;
- no checkout path or `file://` URL leaks into the map;
- every generated Host file exactly matches its `src/host/` source;
- `lib/` is ignored by Git and the build/prepack toolchain is pinned.

## Change workflow

### Host change

1. Edit the appropriate file under `src/host/`.
2. Run `pnpm test`; its `pretest` step rebuilds `lib/` before Host and artifact tests run.
3. Run `pnpm verify` before committing.

### Client change

1. Edit the appropriate module under `src/client/`, never `lib/client.js` or its map.
2. Run `pnpm build` and review both the source change and generated output.
3. Run `pnpm verify` before committing.

Commit source, tests, build scripts, configuration and documentation. **Do not commit `lib/` or rely on generated files surviving a checkout.** For `link:` development, run `pnpm build` before starting DSH so `lib/index.js` and `lib/client.js` exist.

To boot DSH against this checkout without installing it, copy the tracked template `dev/notix.patch.example.yml` to `dev/notix.patch.local.yml`, replace its placeholder `name` path with the absolute `lib/index.js` of this checkout, then run `pnpm build` and `dsh --profile web --patch ./dev/notix.patch.local.yml --dump-config`. `dev/*.local.yml` is ignored by Git, so machine-specific absolute paths never enter the repository; the template itself only carries `/absolute/path/to/notix-dsh`.
