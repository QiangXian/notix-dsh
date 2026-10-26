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
      index.js          BUILTIN_CHANNELS registry (darwin -> macos, win32 -> windows)
      base.js           SystemChannel base: config access, sound/click URL, backend cache, platform guard
      shared.js         package-root lookup and the shared process runner
      macos.js          macOS backends: helper app > terminal-notifier > alerter > osascript
      windows.js        WindowsChannel (`windows-system`): PowerShell + WinRT toast backend
      toast.ps1         ASCII-only WinRT toast helper, copied verbatim into lib/
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
  channels/             Host modules and toast.ps1 copied from src/host/channels/
  triggers/             Host modules copied from src/host/triggers/
  client.js             Browser factory bundle emitted by tsdown
  client.js.map         Client source map emitted by tsdown
```

`lib/` is listed in `.gitignore`. A clean checkout therefore starts without runtime artifacts; the build, test and packaging commands create them as needed. The npm allowlist is runtime-only: the tarball carries the generated `lib/`, `assets/`, `locale/`, `cordis.patch.yml`, `icon.png`, the macOS helper build inputs (`scripts/build-notifier-app.sh`, `scripts/notifier/`) and the READMEs. Development sources, tests, docs and build tooling stay out of the package; `prepack` regenerates `lib/` from `src/` at publish time. If an existing repository already tracks `lib/`, remove it from the Git index once with `git rm -r --cached lib` after moving the sources; `.gitignore` alone does not untrack earlier artifacts.

## Build architecture

`node scripts/build.mjs` performs one complete build:

1. Verify that the clean target is exactly the project's non-symlink `lib/` directory.
2. Remove and recreate `lib/`.
3. Copy `src/host/` into `lib/` without transforming any file: JavaScript modules and resource files such as `channels/toast.ps1` are byte-for-byte identical in both trees.
4. Bundle `src/client/index.js` into `lib/client.js` and emit `lib/client.js.map` with tsdown.
5. Reject missing or additional files, including accidental Client chunks.

Host files are copied rather than bundled so their module boundaries, relative imports and stack locations stay intact. The copies are byte-for-byte identical to their sources. Client code is bundled because DSH expects one classic-script factory artifact.

Host resource lookup must work from both `src/host/` and `lib/`. Locate package-level resources through the nearest `package.json`, as in `src/host/channels/shared.js`, rather than assuming a fixed directory depth.

## Notification channels

Host delivery is split into a small adapter layer under `src/host/channels/`:

- `base.js` exports the shared `SystemChannel` base class. It provides live configuration access, sound and click-to-open URL derivation, one-time backend detection (a successful backend choice is cached; a failed detection is not cached as a backend), and a platform guard that rejects delivery before spawning anything on the wrong OS.
- `shared.js` exports `findPackageRoot()` (walk up to the nearest `package.json`, so resources resolve from both `src/host/` and `lib/`) and `runTool()` (the shared `execFile` runner with `windowsHide` and a timeout).
- `macos.js` exports `MacosChannel` (`macos-system`): signed Notix helper app > `terminal-notifier` > `alerter` > `osascript`.
- `windows.js` exports `WindowsChannel` (`windows-system`): the Windows PowerShell/WinRT toast backend. The payload is passed through `NOTIX_*` environment variables, never through command-line quoting.
- `toast.ps1` is the ASCII-only PowerShell toast helper invoked by the Windows adapter.
- `index.js` exports `BUILTIN_CHANNELS` (`darwin -> macos`, `win32 -> windows`) and `createPlatformChannels(resolveChannelConfig, logger, platform = process.platform)`. `core/notix.js` registers only the current platform's configured channel and disposes the previous registration when configuration changes, so a config file containing both channel blocks is safe: the other platform's block is never registered and never spawns a process.

All built-in channels are plain JavaScript modules copied into `lib/` by the build. No new runtime dependency is introduced; the Windows channel relies on `powershell.exe` being available at runtime.

### Adding a platform channel

1. Create `src/host/channels/<platform>.js` and extend `SystemChannel` from `./base.js`. Declare `id`, `platform` and `platformLabel`, implement `detectBackend()`, and implement `deliver(backend, notification)` using the inherited `run()` helper and the environment payload.
2. Register it in `src/host/channels/index.js` in `BUILTIN_CHANNELS` under the matching `process.platform` value. Platform selection is the only registration mechanism; never register a channel for another platform.
3. Add its configuration defaults in `src/host/config.js`, a schema block in `src/host/schema.js`, shipped defaults in `cordis.patch.yml`, and the Settings card fields in `src/client/`.
4. Add contract tests for the base class, the adapter's argv/env, and platform selection. Tests must never spawn a real notification process; assert the runner arguments instead. Keep a manual verification script (like `scripts/test-macos-notification.mjs` / `scripts/test-windows-notification.mjs`) for real-OS checks.
5. If the channel needs a script or binary resource, put it under `src/host/channels/` (or `assets/`); the build copies `src/host/` verbatim, so there is no bundler step for it.

`toast.ps1` has two extra rules, because Windows PowerShell 5.1 decodes script files with the ANSI code page unless a BOM is present:

- keep the file ASCII-only; `build:check` compares it byte-for-byte with `lib/`;
- pass user text through environment variables, never through the script source or command-line quoting.

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

# Send one real OS notification through the built channel (run pnpm build first).
pnpm notify-test      # macOS
pnpm notify-test:win  # Windows
```

`prepack` runs `pnpm build`, so `npm pack` and `npm publish` also work from a checkout where `lib/` does not exist. `build:check` never writes into the project and does not depend on Git metadata. `notify-test` and `notify-test:win` post real notifications and are never part of `pnpm test`.

CI runs the same gate: `.github/workflows/verify.yml` executes `pnpm install --frozen-lockfile` and `pnpm verify` on Node 22 and 24 for every push and pull request. Dependabot keeps the npm and GitHub Actions dependencies current, and `.github/ISSUE_TEMPLATE/` collects the platform details notification bugs need. `prepublishOnly` repeats `pnpm verify` before every publish, so CI and the release both use one definition of "green".

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

If the change touches a channel adapter or `channels/toast.ps1`, also run `pnpm build:check` and confirm the copied helper still matches its source byte-for-byte. Never edit `lib/channels/*` directly; edit `src/host/channels/*` and rebuild. The Windows helper must remain ASCII-only, and platform-specific code must be reachable only through `BUILTIN_CHANNELS` so other platforms spawn no process.

### Client change

1. Edit the appropriate module under `src/client/`, never `lib/client.js` or its map.
2. Run `pnpm build` and review both the source change and generated output.
3. Run `pnpm verify` before committing.

Commit source, tests, build scripts, configuration and documentation. **Do not commit `lib/` or rely on generated files surviving a checkout.** For `link:` development, run `pnpm build` before starting DSH so `lib/index.js` and `lib/client.js` exist.

To boot DSH against this checkout without installing it, copy the tracked template `dev/notix.patch.example.yml` to `dev/notix.patch.local.yml`, replace its placeholder `name` path with the absolute `lib/index.js` of this checkout, then run `pnpm build` and `dsh --profile web --patch ./dev/notix.patch.local.yml --dump-config`. `dev/*.local.yml` is ignored by Git, so machine-specific absolute paths never enter the repository; the template itself only carries `/absolute/path/to/notix-dsh`.

## Release

1. Bump `version` in `package.json` and keep the top-level `engines.dsh` (not `dsh.engines.dsh` — the runtime reads the manifest root) aligned with the runtime versions this release was verified against.
2. Run `pnpm verify`: it rebuilds `lib/`, runs the full test suite, smokes the Client bundle and checks full-tree reproducibility. `prepublishOnly` repeats this gate on every publish.
3. Inspect the published file set with `npm pack --dry-run --json`. It must contain exactly `lib/` (including `lib/channels/toast.ps1`), `assets/`, `locale/*.json`, `cordis.patch.yml`, `icon.png`, `scripts/build-notifier-app.sh`, `scripts/notifier/NotixNotifier.swift`, `README.md`, `README.zh.md` and `LICENSE`. It must not contain `src/`, `test/`, `dev/`, `docs/`, the other `scripts/*.mjs`, `tsdown.config.mjs`, `build/`, `.tmp/` or `node_modules/`.
4. Commit, then tag the commit (`git tag v<version>`).
5. Publish from the repository root with `pnpm publish` (local manual release). The npm lifecycle runs `prepublishOnly` → `prepack` → publish, so `lib/` is regenerated from `src/` and verified even though it is not committed.
6. Verify the result with `npm view notix-dsh version dist.tarball` and a throwaway install; see [docs/PUBLISHING.md](PUBLISHING.md) for the full pre-flight checklist, command sequence and rollback steps.
