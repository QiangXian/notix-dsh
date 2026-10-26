# Publishing `notix-dsh` to npm

Practical runbook for releasing this package to the public npm registry. It is written for the
**local, manual release** path that this repository uses: one maintainer, one machine, `pnpm publish`
from a clean checkout.

See [DEVELOPMENT.md](DEVELOPMENT.md) for the build/test workflow and
[DEVELOPMENT.md § Release](DEVELOPMENT.md#release) for the short checklist. This document is the
long form: pre-flight, the exact command sequence, the tarball contract, DSH-side install and
compatibility mechanics, post-publish verification, and rollback.

Facts below were verified on 2026-10-26 against `notix-dsh@0.3.0` with:

| Tool | Version |
| --- | --- |
| Node (build/verify) | 22.23.2 (`engines.node` accepts `^22.18.0 \|\| >=24.0.0`) |
| pnpm | 10.26.2 (pinned by `packageManager`) |
| npm CLI | 10.9.8 (pnpm 10 delegates the upload to it) |
| DeepSeek Harness desktop runtime | dsh **0.2.1-rc.3** (Node 24.21.0, pnpm 11.28.5) |

---

## 1. What is published, and why each path must be there

The package is two halves of one DSH plugin: a **Host** half (`lib/index.js`, loaded by the Cordis
Loader) and a **Client** half (`lib/client.js`, served to the web UI by `dsh-client-modules`), plus
notification-channel resources and optional macOS helper build inputs.

`files` allowlist (final, 10 entries):

```json
[
  "lib",
  "assets",
  "locale",
  "cordis.patch.yml",
  "icon.png",
  "scripts/build-notifier-app.sh",
  "scripts/notifier",
  "README.md",
  "README.zh.md",
  "LICENSE"
]
```

`package.json`, `README.md` and `LICENSE` are also force-included by npm even if omitted; they are
listed explicitly so the contract is readable in one place. `README.zh.md` is **not** auto-included
and needs its entry.

### 1.1 Runtime contract

| Path in the tarball | Consumed at runtime by | Why it must ship |
| --- | --- | --- |
| `package.json` | npm, DSH loader, `dsh-client-modules`, plugin manager | Manifest: `main`, `exports`, `dsh`, `engines`, `icon`, dependencies. |
| `lib/index.js` | Cordis Loader (`main` and `exports["."]`) | Host plugin entry; exports `name`, `inject`, `apply`, `Config`. |
| `lib/{config,schema}.js`, `lib/core/*.js`, `lib/triggers/*.js`, `lib/channels/{base,index,macos,shared,windows}.js` | `lib/index.js` relative ESM imports | The whole host module tree is needed; a missing file fails the import. |
| `lib/channels/toast.ps1` | `windows.js` via `new URL('./toast.ps1', import.meta.url)` | Windows toast helper. Missing → `notix: the Windows toast helper is missing at …`. |
| `lib/client.js` | `dsh-client-modules` via `exports["./client"]` | Browser bundle, served at `/plugins/notix-dsh/client.js`. Missing → **boot-time failure** of the client module registry. |
| `lib/client.js.map` | browser devtools | Debug map; `sourcesContent` is embedded, so `src/` need not ship. |
| `cordis.patch.yml` | `dsh-app-boot` via `dsh.bundle.patch` | Bundle layer that inserts the `notix` loader row with shipped defaults. Missing/undeclared → package installs as a plain dependency and never activates. |
| `locale/en.json`, `locale/zh.json` | plugin manager via `exports["./locale/*.json"]` | Display metadata (`meta.title`, `meta.description`) in the Plugins UI. Not read by plugin code. |
| `icon.png` | plugin manager via manifest `icon` | Plugin-list icon. Must be PNG/SVG/JPEG/WebP, a regular file **inside the package dir**, ≤ 256 KiB. Current file: 30,909 B, 1024×1024 RGBA PNG. |
| `assets/notifier-icon.png` | `channels/shared.js` (`BUNDLED_ICON`) | Whale icon passed to `terminal-notifier -appIcon` (macOS) and as the Windows toast icon. |
| `scripts/build-notifier-app.sh`, `scripts/notifier/NotixNotifier.swift`, `assets/NotixNotifier.icns` | nothing at runtime | Optional macOS `UNUserNotificationCenter` helper build inputs. Users run the script to produce a signed `~/Applications/Notix.app`; without it the channel falls back to `terminal-notifier`/`alerter`/`osascript`. |
| `README.md`, `README.zh.md`, `LICENSE` | npm / humans | Registry metadata, not runtime. |

### 1.2 Manifest fields that DSH actually reads

| Field | Current value | Read by / consequence |
| --- | --- | --- |
| `main` | `lib/index.js` | Loader entry fallback; `exports["."]` is the authoritative specifier. |
| `exports["."]` | `./lib/index.js` | Cordis `import("notix-dsh")`. |
| `exports["./client"]` | `./lib/client.js` | `dsh-client-modules` resolves it to a path, hashes the file, serves it, and injects it into `window.__DSH_BOOT__`. Must be a string or `{ "default": "…" }`. |
| `exports["./package.json"]` | `./package.json` | `dsh-client-modules` does `require.resolve("notix-dsh/package.json")`; plugin-manager metadata does the same through the ESM resolver. **If missing, the client half silently never loads and the manifest `icon` is dropped** (the locale dictionaries still resolve independently). |
| `exports["./locale/*.json"]` | `./locale/*.json` | Plugin-manager display metadata (see above). |
| `exports["./cordis.patch.yml"]` | `./cordis.patch.yml` | Not used by the loader (it resolves the patch through the package directory), kept as the conventional public export. |
| `type` | `module` | Host files are ESM. The client bundle is CJS-in-a-classic-script; see §8.1. |
| `dsh.bundle.patch` | `./cordis.patch.yml` | Marks the package as a profile bundle; `dsh plugin add` only activates dependencies that declare it. |
| `dsh.client.platform` | `web` | `dsh-client-modules` scans only `web` client packages. |
| `dsh.client.inject` | `@deepseek-ai/dsh-client-locale`, `…-settings`, `…-ui-plugin-manager` | Module-level prerequisites for the client bundle; all three exist in the dsh 0.2.1 app profile. |
| `icon` | `./icon.png` | Plugin-manager icon (see contract above). |
| `engines.node` | `^22.18.0 \|\| >=24.0.0` | npm `EBADENGINE` warning for consumers on older Node; DSH runtime ships Node 24.x. |
| `engines.dsh` | `>=0.2.1-rc.2 <0.3.0` | **Enforced by DSH**, not by npm. See §7. |
| `peerDependencies` | `@deepseek-ai/cordis: ~4.0.5` | Conventional declaration only. This package never imports `@deepseek-ai/cordis`; DSH provides it from the installation module table. Expect a pnpm "missing peer" warning in profiles (`autoInstallPeers: false`), which is harmless. |
| `dependencies` | `@deepseek-ai/schemastery`, `zod` | Installed into the profile by pnpm. `zod` is required by the host; `schemastery` is loaded opportunistically (`lib/index.js` falls back if it cannot be resolved). |
| `publishConfig` | `{ "access": "public", "registry": "https://registry.npmjs.org/" }` | Publish-time access and registry. The registry override wins over a user-level `.npmrc` registry. |
| `files` | allowlist above | The only reliable inclusion mechanism; `lib/` is gitignored and generated, so never rely on implicit packing. |

The client bundle keeps `react` and `@deepseek-ai/dsh-client-ui-primitives` external. DSH's
`window.__ModuleLoader__` `require` provides them, so no `dependencies` entry is needed for either.

---

## 2. Tarball contract

Expected: **33 files**, roughly 750 kB packed / 940 kB unpacked (the 512 KiB `NotixNotifier.icns` is
the bulk; exact bytes move with README text and the generated `lib/`, so treat the file list — not the
size — as the contract). This list is the complete contract:

```text
LICENSE
README.md
README.zh.md
package.json
icon.png
cordis.patch.yml
assets/NotixNotifier.icns
assets/notifier-icon.png
locale/en.json
locale/zh.json
lib/index.js
lib/client.js
lib/client.js.map
lib/config.js
lib/schema.js
lib/channels/base.js
lib/channels/index.js
lib/channels/macos.js
lib/channels/shared.js
lib/channels/toast.ps1
lib/channels/windows.js
lib/core/channels.js
lib/core/notix.js
lib/core/render.js
lib/core/store.js
lib/triggers/approval.js
lib/triggers/completion.js
lib/triggers/error.js
lib/triggers/index.js
lib/triggers/long-task.js
lib/triggers/questions.js
scripts/build-notifier-app.sh
scripts/notifier/NotixNotifier.swift
```

Forbidden (must never appear): `src/`, `test/`, `dev/`, `docs/`, `build/`, `issue/`, `.tmp/`,
`node_modules/`, `tsdown.config.mjs`, `package-lock.json`, any `.log`/`.tgz`/`.DS_Store`, and the
development-only scripts `scripts/build.mjs`, `scripts/smoke-client.mjs`,
`scripts/test-macos-notification.mjs`, `scripts/test-windows-notification.mjs`.

`scripts/` is a **partial** allowlist: only the macOS helper build inputs ship. `scripts/build.mjs`
and the devDependencies (`tsdown`) are intentionally absent, which means **`prepack` only works from
a repository checkout**. An installed copy cannot repack itself — that is by design, not a bug.

### 2.1 Verify the file set (requires a built `lib/`)

```sh
pnpm build   # ensure lib/ is current; prepack also does this during publish

npm pack --dry-run --json --ignore-scripts 2>/dev/null | node -e '
let s = ""
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const files = JSON.parse(s)[0].files.map((f) => f.path)
  console.log(`${files.length} files`)
  const forbidden = files.filter((p) =>
    /^(src|test|dev|docs|build|issue|\.tmp)\//.test(p) ||
    /^scripts\/(build\.mjs|smoke-client\.mjs|test-.*\.mjs)$/.test(p) ||
    p === "tsdown.config.mjs",
  )
  if (forbidden.length > 0) throw new Error(`forbidden paths: ${forbidden.join(", ")}`)
  console.log("runtime-only allowlist OK")
})'
```

Expected: `33 files` then `runtime-only allowlist OK`.

If `~/.npm` is not writable in your shell (sandboxed/CI environments), prefix npm commands with
`NPM_CONFIG_CACHE=$PWD/.tmp/npm-cache`. This also matters for `pnpm publish` — pnpm 10 hands the
upload to the npm CLI (see §5.2).

`--ignore-scripts` skips `prepack`. That is fine **only** because `lib/` already exists. On a fresh
clone, `lib/` does not exist and an `--ignore-scripts` dry-run would silently produce a broken
tarball. Never add `--ignore-scripts` to the real publish.

A stronger, full-lifecycle rehearsal (runs `prepublishOnly` → `prepack`, needs no npm auth) is:

```sh
pnpm publish --dry-run --no-git-checks
```

Expected output includes: `33 files`, `package size` in the ~750 kB range, `unpacked size` in the
~940 kB range, `publishing to https://registry.npmjs.org/ with tag latest and public access`.

The tar header is also worth a glance (file modes come from the working tree):

```sh
npm pack --ignore-scripts --pack-destination .tmp >/dev/null
tar tvzf .tmp/notix-dsh-0.3.0.tgz | head -40
```

Note: a checkout with a restrictive umask (as on the maintainer machine) packs some files as
`0600` and the helper script as `0711`. Per-user profile installs still work because the installing
user owns the files, but normalizing before a release keeps the package conventional:

```sh
chmod -R u+rwX,go+rX lib locale assets icon.png LICENSE README.md README.zh.md cordis.patch.yml
chmod 0755 scripts/build-notifier-app.sh scripts/notifier
# Files in CI checkouts are already 0644/0755; this is only a local-umask cleanup.
```

A one-off `chmod` is not enough by itself: `prepublishOnly` → `prepack` **rebuilds `lib/` during the
publish**, and the build writes new files under the shell's umask (notably `lib/client.js`, written
by tsdown). Run the real publish with a conventional umask so the files it creates are `0644` too:

```sh
(umask 022 && pnpm publish --access public)
```

The `chmod` above also fixes the tracked sources once (`cp` in `scripts/build.mjs` preserves source
modes), so a `umask 022` publish then produces a fully conventional tarball.

---

## 3. One-time setup

```sh
# Match the pinned toolchain.
corepack enable
pnpm install --frozen-lockfile

# npm auth: pnpm 10 delegates the actual upload to the npm CLI, so npm credentials are what matter.
npm login
npm whoami

# The name must be free (verified 2026-10-26: 404, i.e. available).
npm view notix-dsh
```

- Account: the npm user must own the unscoped name `notix-dsh` (first publish claims it).
- 2FA: if the account uses "auth and writes", keep an OTP ready (`--otp=<code>`); `npm login` alone is
  not enough for the publish step.
- Token-based publishing (CI or `NODE_AUTH_TOKEN`): needs read-write access to `notix-dsh`.
- Registry: `publishConfig.registry` pins npmjs.org for publishing; consumers' registries are
  unaffected.
- Repository metadata is set (`repository`, `homepage`, `bugs`, MIT `LICENSE`). **Verify the
  repository is publicly reachable before publishing** — npmjs.com's repository/homepage/bugs links
  and any `raw.githubusercontent.com` README images depend on it. Unauthenticated checks:

  ```sh
  curl -s -o /dev/null -w 'repo page: %{http_code}\n' https://github.com/QiangXian/notix-dsh
  curl -s -o /dev/null -w 'repo api:  %{http_code}\n' https://api.github.com/repos/QiangXian/notix-dsh
  # 200 = public; 404 = private or not created yet (fix the URL or make the repo public first).
  ```

- `engines.dsh` is **not** an npm engine: npm ignores it and never blocks on it. It is enforced by
  DSH only (§7).

---

## 4. Pre-flight checklist

Run in order; do not skip the dry-run.

1. **Clean, current tree.** `git status --short` empty, on `main`, `git pull --ff-only`.
2. **Version.** `version` is `0.3.0` (first public release; do not renumber for the first publish).
3. **Runtime alignment.** `engines.dsh` is `>=0.2.1-rc.2 <0.3.0`, which is satisfied by the desktop
   app runtime **0.2.1-rc.3**. The global CLI on the maintainer machine is **0.1.0-rc.6** and is
   *older* than this range — do not use it for verification (§7.4).
4. **Dependencies installed.** `pnpm install --frozen-lockfile`; `prepack`/`prepublishOnly` need the
   pinned devDependencies (`tsdown`), which are not in the tarball.
5. **Full local gate.** `pnpm verify` → rebuilds `lib/`, runs the full test suite (67 passing tests;
   the Windows-only end-to-end test is skipped on macOS), client bundle smoke, and the
   byte-for-byte `build:check` reproducibility check.
6. **File set.** The `npm pack --dry-run` check in §2.1 → 33 files, no forbidden paths.
7. **Full lifecycle rehearsal.** `pnpm publish --dry-run --no-git-checks` → same 33 files, public
   access, `latest` tag, npmjs.org registry, no auth required.
8. **Lint the package metadata.** `npx publint@0.3.18` → exactly one accepted warning (§8.1).
9. **README rendering.** `docs/` is not shipped, so any `docs/assets/*.png` relative link in
   `README.md`/`README.zh.md` points at files that are not in the tarball. Either use absolute
   `https://raw.githubusercontent.com/QiangXian/notix-dsh/main/...` URLs (only render for visitors if
   the repository is public — see item 10) or keep the README text-only; verify the rendering on
   npmjs.com after publish.
10. **Repository reachability.** The repository/homepage/bugs links must resolve for anonymous
    visitors; check with §3's two `curl` probes. Do not publish pointing at a private or placeholder
    repository.
11. **README.zh.md** is included for repository/package completeness; npmjs.com renders the primary
    `README.md` only.
12. **2FA / account.** `npm whoami` returns the owner account; OTP available.
13. **No secrets or machine-specific paths** in the files being released (`grep -R "/Users/" lib
    scripts locale README.md`).

Optional but recommended: record the release in a Git tag and a changelog or GitHub Release. This
repository has no `CHANGELOG.md`; a GitHub Release with the diff link is enough.

---

## 5. Publish

### 5.1 Commit and tag first

```sh
git add -A
git commit -m "release: notix-dsh 0.3.0"
git tag v0.3.0
git push origin main
git push origin v0.3.0
```

Publishing after the tag means the registry artifact corresponds to a commit you can point at.

### 5.2 Primary path (local manual release)

```sh
(umask 022 && pnpm publish --access public)
```

`pnpm publish` runs the npm publish lifecycle and, for pnpm 10, delegates the final upload to the npm
CLI:

1. `prepublishOnly` → `pnpm verify` (build + tests + client smoke + reproducibility),
2. `prepack` → `pnpm build` (regenerates the gitignored `lib/`),
3. pack + upload with npm's auth, cache, and 2FA flow.

Expected console result: `33 files`, a `package size` in the ~750 kB range, an `unpacked size` in the
~940 kB range, `publishing to https://registry.npmjs.org/ with tag latest and public access`, then
`+ notix-dsh@0.3.0`.

pnpm performs git checks by default (publish branch `main`, clean tree, up to date with remote).
They pass after §5.1. If you deliberately publish from a dirty tree or a non-release branch:

```sh
pnpm publish --access public --no-git-checks   # the rehearsal command, now against the registry
```

Use `--no-git-checks` only when you understand exactly what changed, and never route around a failing
`pnpm verify`.

### 5.3 Flags and variants

| Situation | Command |
| --- | --- |
| 2FA code required | `pnpm publish --access public --otp=<code>` (or `PNPM_CONFIG_OTP=<code>`) |
| Prerelease | `pnpm publish --access public --tag next` (keeps `latest` untouched) |
| Publishes to a mirror | `pnpm publish --access public --registry=https://…` (or edit `publishConfig.registry`; confirm the target URL in the dry-run) |
| Explicit npm path | `npm publish --access public` (same lifecycle: `prepublishOnly` + `prepack`) |
| Prebuilt tarball | `pnpm pack` then `npm publish notix-dsh-0.3.0.tgz --access public` |
| npm cache not writable | prefix with `NPM_CONFIG_CACHE=/writable/dir` (pnpm 10 delegates to npm) |

Do **not** publish with `--ignore-scripts` (skips `prepublishOnly`/`prepack`) or `--force` (bypasses
the "version already exists" guard) except as an explicit recovery action.

---

## 6. Post-publish verification

### 6.1 Registry metadata

```sh
npm view notix-dsh version dist-tags dist.tarball dist.integrity time.modified
npm view notix-dsh engines peerDependencies --json
```

Expect: `0.3.0`, `latest: 0.3.0`, a `https://registry.npmjs.org/notix-dsh/-/notix-dsh-0.3.0.tgz`
tarball, an `sha512-…` integrity, `engines.dsh` intact, and `published at` earlier than `modified`.

### 6.2 Re-download and inspect the published tarball

```sh
mkdir -p .tmp/postpublish && cd .tmp/postpublish
npm pack notix-dsh@0.3.0
tar tzf notix-dsh-0.3.0.tgz | sort          # 33 paths, same list as §2, no src/test/docs
tar xzf notix-dsh-0.3.0.tgz                 # extracts to package/
```

### 6.3 Installed-package contract checks (no DSH needed)

Simulate the DSH profile's install layout (`nodeLinker: hoisted`, `autoInstallPeers: false`):

```sh
mkdir -p .tmp/notix-consumer && cd .tmp/notix-consumer
printf 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n' > pnpm-workspace.yaml
printf '{"name":"notix-consumer","private":true,"version":"0.0.0"}\n' > package.json
pnpm add notix-dsh@0.3.0
# Expected: 5 packages added, one pnpm warning: missing peer @deepseek-ai/cordis@~4.0.5 (harmless).
```

Then assert the contract (all of these were verified to pass for the 0.3.0 artifact):

```sh
# Host half imports with only its declared dependencies; no cordis needed.
node -e 'import("notix-dsh").then((m) => console.log(m.name, m.inject, typeof m.apply, !!m.Config))'
# → notix [ 'sessions', 'timer', 'sessionProjections' ] function true

# Every runtime resource resolves through the package's own exports.
node -e '
const { existsSync } = require("node:fs")
const { dirname, join } = require("node:path")
const root = dirname(require.resolve("notix-dsh/package.json"))
for (const rel of [
  "lib/index.js", "lib/client.js", "lib/client.js.map", "lib/channels/toast.ps1",
  "assets/notifier-icon.png", "cordis.patch.yml", "locale/en.json", "locale/zh.json", "icon.png",
]) console.log(existsSync(join(root, rel)) ? "ok  " : "MISSING", rel)
'
# → every line "ok"; no MISSING

# Channel wiring (internal modules are not exported as subpaths by design; import the file URL).
node --input-type=module -e '
import { pathToFileURL } from "node:url"
const root = new URL("./node_modules/notix-dsh/", pathToFileURL(process.cwd() + "/"))
const reg = await import(new URL("lib/channels/index.js", root))
console.log(Object.keys(reg.BUILTIN_CHANNELS))                    // [ "darwin", "win32" ]
for (const p of ["darwin", "win32"]) {
  const built = reg.createPlatformChannels(() => ({ enabled: true }), console, p)
  console.log(p, "->", built.channels.map((c) => c.id))
}
'
# → darwin -> [ 'macos-system' ]
# → win32  -> [ 'windows-system' ]
```

`BUNDLED_ICON` (the multi-platform whale icon) resolves through the same file URL:

```sh
node --input-type=module -e '
import { pathToFileURL } from "node:url"
import { existsSync } from "node:fs"
const root = new URL("./node_modules/notix-dsh/", pathToFileURL(process.cwd() + "/"))
const { BUNDLED_ICON } = await import(new URL("lib/channels/shared.js", root))
console.log(BUNDLED_ICON, existsSync(BUNDLED_ICON))
'
# → …/node_modules/notix-dsh/assets/notifier-icon.png true
```

Client bundle smoke (the script is a development tool and is **not** in the tarball; run it from a
repository checkout):

```sh
node /path/to/notix-dsh/scripts/smoke-client.mjs \
  .tmp/notix-consumer/node_modules/notix-dsh/lib/client.js notix-dsh
# → OK …/lib/client.js: id=notix-dsh apply=function inject=[slots, locale, configForms]
```

### 6.4 Authoritative DSH load test

Use a dsh runtime that satisfies `engines.dsh` (**≥ 0.2.1-rc.2**). The desktop app bundles
**0.2.1-rc.3**; the terminal `dsh` on the maintainer machine is 0.1.0-rc.6 and is too old to make
claims about this package (§7.4).

**Desktop app (the real target):**

1. Fully quit DeepSeek Harness.
2. Reopen it, then open **Settings → Plugins → Install** and install `notix-dsh@0.3.0` from the
   default registry (the in-app manager runs pnpm inside `~/.dsh/profiles/desktop` and prompts for a
   restart when required). The install is rejected before anything is written if `engines.dsh` does
   not match the running app (§7.2).
3. Restart when asked. Confirm the plugin appears with the Notix icon and localized title
   (from `icon.png` + `locale/*.json`), and that **“Notix notifications”** appears in the Plugins
   settings section.
4. Trigger one notification (an approval prompt, a pending question, or the settings card's test
   action) and confirm the native banner on the platform.

**Scratch profile (CLI, non-desktop profiles):**

```sh
dsh plugin --profile notix-smoke add notix-dsh@0.3.0
# success implies the registry manifest passed the compatibility preflight

dsh --profile notix-smoke --dump-config | grep -n -A3 'notix'
# → an inserted `notix` row (the bundle patch composed); an incompatible bundle instead prints
#   `dsh: skipping profile bundle "notix-dsh": …`
```

The CLI cannot manage the app-owned `desktop` profile ("profile desktop is managed exclusively by
the Electron application") — use the in-app Plugin Manager for desktop.

### 6.5 Smoke the package artifacts that DSH will not exercise for you

- `scripts/build-notifier-app.sh` still runs from the extracted tarball (`sh scripts/build-notifier-app.sh`
  or `./…` — the file ships executable). It needs Swift and `assets/NotixNotifier.icns`, both present.
- Windows: `lib/channels/toast.ps1` is the only runtime file that is neither JavaScript nor JSON;
  §6.3 checks its presence.

---

## 7. How DSH installs, activates, and gates this package

Understanding this is what makes packaging mistakes diagnose themselves.

### 7.1 Install path

`dsh plugin --profile <name> <pnpm args>` forwards verbatim to pnpm in
`~/.dsh/profiles/<name>` (created on first use — from a shipped template for known profile names,
otherwise with `@deepseek-ai/dsh-base`). The profile's `pnpm-workspace.yaml` sets:

```yaml
packages:
  - .
nodeLinker: hoisted
autoInstallPeers: false
```

After a successful package operation, DSH reconciles `dsh.profile.bundles`: **every dependency whose
manifest declares `dsh.bundle` is appended to the layer stack**; a dependency without `dsh.bundle`
only produces a warning and never activates. That is why `dsh.bundle.patch` is mandatory.

The in-app Plugin Manager performs the same pnpm operations for the `desktop` profile through
`@deepseek-ai/dsh-plugin-manager` (restart required for host-side changes; the manager also handles
build-script approvals and registry selection).

### 7.2 `engines.dsh` enforcement (install time)

`@deepseek-ai/dsh-plugin-manager` preflights each named registry spec with
`pnpm view <spec> name version engines peerDependencies --json`, then re-checks the installed
packages after pnpm finishes. Rules (from `@deepseek-ai/dsh-app-boot`'s plugin-compatibility):

- An own **top-level `engines.dsh`** decides *alone*; peerDependencies are then ignored.
- Without `engines.dsh`, every `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer must satisfy the
  running version.
- Prereleases participate in ranges; `workspace:` ranges are meaningful only in peer fields.

On a mismatch the install is **rejected**: the preflight path installs nothing
(`dsh: installation rejected: … dsh: nothing was installed.`, exit code 1), and a post-install
mismatch restores `package.json`/`pnpm-lock.yaml` before failing. For an already-installed, untouched
dependency the manager only warns; the bundle is then denied at startup. The escape hatch is an
explicit, exact-version exemption (profile-scoped; for the app-owned `desktop` profile use the in-app
Plugin Manager):

```sh
dsh plugin --profile <profile> allow-version notix-dsh@0.3.0 --dsh-version 0.2.1-rc.3 --accept-risk
dsh plugin --profile <profile> version-exemptions      # inspect
dsh plugin --profile <profile> revoke-version notix-dsh@0.3.0 --dsh-version 0.2.1-rc.3
```

It is stored in `<profile>/compatibility.json` and should not be needed for 0.3.0.

### 7.3 `engines.dsh` enforcement (load time)

`loadProfileDirectory` evaluates every bundle's requirements on boot. A mismatch does not crash the
app: the bundle is skipped and reported:

```text
dsh: skipping profile bundle "notix-dsh": Plugin notix-dsh@0.3.0 is incompatible with dsh …:
requirements {"engines.dsh":">=0.2.1-rc.2 <0.3.0"}. …
```

The app boots without Notix. So a wrong range either blocks installation or silently disables the
plugin with a stderr diagnostic — never a half-loaded plugin.

Current value `>=0.2.1-rc.2 <0.3.0` covers the verified 0.2.1-rc.3 app runtime and future 0.2.x
prereleases/stables. Widen it only after verifying against the newer runtime.

### 7.4 The stale global CLI trap

The `dsh` in `~/.local/bin` on this machine is **0.1.0-rc.6** (installed 2026-08-13), while the
desktop app carries dsh **0.2.1-rc.3** (`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/runtime.json`).
The 0.1.x CLI predates the compatibility preflight and its dependency closure does not contain every
client package this plugin declares (for example `@deepseek-ai/dsh-client-ui-plugin-manager` is
missing from the 0.1.0-rc.6 closure), so:

- `dsh --version` before any install/verify step;
- verify against the desktop app runtime (or a dsh ≥ 0.2.1-rc.2 CLI), never the stale binary;
- the desktop app's Plugin Manager is the supported installer for the `desktop` profile.

### 7.5 Client half

`@deepseek-ai/dsh-client-modules` scans live Loader entries for packages that declare
`dsh.client.platform === "web"`, resolves `exports["./client"]`, and serves it as
`/plugins/notix-dsh/client.js?rev=<hash>`; `window.__DSH_BOOT__` carries the entry graph.
Consequences for packaging:

- `exports["./client"]` but no file → loud boot error (`client-modules: client bundle not found`).
- `dsh.client` declared but no `exports["./client"]` → loud error at boot
  (`declares dsh.client but exports no "./client" bundle`).
- No `exports["./package.json"]` → the package is treated as "not a client package", so the client
  half is **silently** absent; the manifest `icon` (and the name/description fallback) is dropped while
  localized title/description still resolve from the locale exports.
- `dsh.client.inject` names must exist in the app's module table; all three currently do in 0.2.1.

The client bundle is CJS wrapped in `window.__ModuleLoader__.load({ id, factory })`; the banner is
generated by `tsdown.config.mjs`. This is the one intentional divergence from ESM, and it is why
publint reports the warning in §8.1.

### 7.6 Host dependency resolution

- `@deepseek-ai/schemastery` and `zod` are real dependencies and are installed into the profile.
- `@deepseek-ai/cordis` is a peer. With `autoInstallPeers: false` pnpm only warns. DSH heals
  `~/.dsh/profiles/node_modules` from its own installation tree on boot, and this package never
  imports cordis, so the peer is declarative only. Do not move it to `dependencies` (that would pin a
  second copy of cordis in the profile).
- `@deepseek-ai/dsh-client-ui-primitives` and `react` are provided by the browser module table, not
  by npm dependencies.

---

## 8. Known, accepted warnings

### 8.1 publint: CJS client bundle inside `"type": "module"`

`npx publint@0.3.18` reports exactly one warning:
`exports["./client"] is ./lib/client.js written in CJS but interpreted as ESM` (because of
`"type": "module"`). This is a false positive for this package: DSH never `import()`s
`lib/client.js` from Node. It fetches the file over HTTP and evaluates it in the browser through
`window.__ModuleLoader__` (see §7.5). Do not rename it to `.cjs` or add a conditional export — that
would break `dsh-client-modules`, which reads the string path verbatim.

### 8.2 pnpm "missing peer @deepseek-ai/cordis"

Expected with the profile's `autoInstallPeers: false`; documented in §7.6. Not an install failure.

### 8.3 npm does not understand `engines.dsh`

npm only validates `engines.node`/`engines.npm`; the `dsh` key is inert at npm-install time and is
enforced by DSH (§7.2, §7.3). Note it belongs at **`engines.dsh`**, not under `dsh.engines`.

### 8.4 pnpm version drift

Rehearsals here use the pinned pnpm 10.26.2, whose `publish` delegates to the npm CLI.
pnpm 11 implements publishing natively and, by default, strips `packageManager` and lifecycle scripts
from the published manifest (`--skip-manifest-obfuscation` keeps them). No action is needed for
0.3.0; if the pin is ever moved to pnpm 11, re-check the published manifest and do not pass
`--skip-manifest-obfuscation` casually.

### 8.5 File modes from a local umask

See §2.1. Harmless for per-user profiles; normalize with `chmod` before publishing.

---

## 9. Rollback and incident response

The registry is immutable: once `notix-dsh@0.3.0` exists it can never be reused, even if unpublished.
Prefer deprecate-and-republish over unpublish.

```sh
# 1. Warn every installer immediately (works for any age; empty message clears it):
npm deprecate notix-dsh@0.3.0 "0.3.0 has a packaging bug: <one line>. Use 0.3.1 instead."
npm deprecate notix-dsh@0.3.0 ""

# 2. Ship a fixed release (bump version, run §4–§5; `latest` follows automatically):
#    pnpm publish --access public

# 3. Re-tag if a bad version must never be installed by `latest`:
npm dist-tag ls notix-dsh
npm dist-tag add notix-dsh@<older-version> latest   # only when an older version exists
npm dist-tag rm notix-dsh next
```

Unpublish is only for a catastrophic first release, per npm policy:

- within **72 hours** of publishing, if **no other package depends on it**;
  `npm unpublish notix-dsh@0.3.0`;
- after 72 hours, only if it has no dependents, **< 300 downloads in the last week**, and a single
  maintainer;
- unpublishing **all** versions of a name blocks republishing that name for **24 hours**;
- an unpublished `name@version` can never be republished.

Incident checklist: deprecate → publish patch → verify §6 → post a GitHub Release note / issue.

---

## 10. Versioning policy

- Current line: **0.3.x**, first public release `0.3.0`. `^0.3.0` resolves to `0.3.x` only.
- Pre-1.0, treat **minor as breaking**: a config schema change, a removed channel id, or a changed
  `dsh.client`/exports contract ships in `0.4.0`; fixes ship in `0.3.x`.
- Prereleases use `--tag next` (`0.4.0-rc.1`) so `latest` keeps pointing at the stable line.
- Keep `engines.dsh` tied to the runtime versions a release was actually verified against, and bump it
  only together with that verification.
- Go `1.0.0` when the config schema, the `dsh.client` contract, and the host entry surface are
  considered frozen and have been verified across at least two DSH minor releases. Until then the
  0.x caveat honestly signals that DSH-side APIs may still move.

---

## 11. Appendix A — GitHub Actions with provenance / trusted publishing (optional)

Local manual publishing is the chosen path for 0.3.0 and cannot produce provenance attestations.
If the project later moves releases to CI, keep the same lifecycle gate and let npm attach
provenance (`npm publish --provenance`; `pnpm publish --provenance` is also accepted by pnpm 10.26.2
and forwards publish flags to the npm CLI):

```yaml
# .github/workflows/publish.yml
name: publish
on:
  workflow_dispatch:
    inputs:
      tag:
        description: npm dist-tag
        default: latest
permissions:
  contents: read
  id-token: write          # provenance + OIDC trusted publishing
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.26.2
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm verify
      - run: npm publish --access public --tag "${{ inputs.tag }}" --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Notes:

- Configure a **Trusted Publisher** on the package's npmjs.com settings page after the first manual
  publish (repo + workflow file), then drop `NODE_AUTH_TOKEN` and let OIDC authenticate; provenance is
  attached automatically for public repositories on supported runners.
- The `pnpm verify` step is the same gate as `prepublishOnly`; `npm publish` still runs `prepack`
  (`pnpm build`) so `lib/` is generated in CI.
- `pnpm install --frozen-lockfile` is mandatory: `prepack` needs the pinned `tsdown` devDependency
  that is intentionally absent from the tarball.
- Keep `--provenance` off for self-hosted runners (supported only in specific environments).

---

## 12. Appendix B — Quick reference

```sh
# Pre-flight
git status --short && git pull --ff-only
pnpm install --frozen-lockfile
pnpm verify
pnpm build   # only if you want to inspect lib/ before the dry-run
npm pack --dry-run --json --ignore-scripts          # 33 files, no forbidden paths
pnpm publish --dry-run --no-git-checks              # full lifecycle rehearsal, no auth
npx publint@0.3.18                                  # 1 accepted warning

# Release
git add -A && git commit -m "release: notix-dsh 0.3.0"
git tag v0.3.0 && git push origin main && git push origin v0.3.0
pnpm publish --access public

# Verify
npm view notix-dsh version dist-tags dist.tarball dist.integrity
# re-download, then §6.3 contract checks + scripts/smoke-client.mjs
# plus in-app install in DeepSeek Harness (Settings → Plugins), restart, notification test

# Rollback (preferred over unpublish)
npm deprecate notix-dsh@0.3.0 "message"
# fix, bump patch, publish again
```

## 13. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `npm view notix-dsh` → `E404` before release | Name not published yet | Expected; it means the name is available. |
| `E403`/`EOTP` on publish | Not logged in, token lacks write access, or 2FA required | `npm login`; add `--otp=<code>`; token scope read-write. |
| `EPUBLISHCONFLICT` / "version already exists" | Version already published; registry is immutable | Bump the version; never reuse. |
| Published tarball has no `lib/` | Publish ran with `--ignore-scripts` or outside the repo checkout | Re-run `pnpm publish` without `--ignore-scripts`; verify §2.1. |
| Install rejected: `dsh: installation rejected … nothing was installed` | `engines.dsh` does not match the running dsh | Use a dsh runtime in `>=0.2.1-rc.2 <0.3.0`, or an exact-version exemption (§7.2). |
| App boots but Notix is absent; log says `skipping profile bundle "notix-dsh"` | `engines.dsh` mismatch | Same as above; check `dsh --version`/app runtime (§7.4). |
| Package installed as a plain dependency, never activates | `dsh.bundle.patch` missing from the installed manifest | Rebuild/reinstall; the tarball must contain `cordis.patch.yml` and the `dsh.bundle` field. |
| Plugin list has no icon/title, or no client UI at all | `exports["./package.json"]`, `exports["./locale/*.json"]`, `icon.png` or `exports["./client"]` missing | Compare against §1.2; re-publish a fixed version. |
| Boot error: `client bundle not found` / `declares dsh.client but exports no "./client" bundle` | `lib/client.js` absent or `exports["./client"]` removed | Restore both; never publish with a stale/empty `lib/`. |
| Windows: `the Windows toast helper is missing` | `lib/channels/toast.ps1` excluded | Keep `lib` in the allowlist (it ships the copied helper). |
| macOS: banner uses Script Editor icon | Signed helper app not installed and no `terminal-notifier` | Build `scripts/build-notifier-app.sh --install` with `NOTIX_SIGN_IDENTITY`, or install `terminal-notifier`. |
| pnpm warns `missing peer @deepseek-ai/cordis@~4.0.5` | Profile uses `autoInstallPeers: false` | Expected; DSH supplies cordis (§7.6). |
| `pnpm publish` says working tree is dirty / branch not publishable | pnpm git checks | Commit and tag first (§5.1), or use `--no-git-checks` deliberately. |
| npm cache `EACCES` | `~/.npm` not writable (locked-down environment) | `NPM_CONFIG_CACHE=/writable/dir pnpm publish …`. |
| README images broken on npmjs.com | Relative `docs/assets/…` links; `docs/` is not shipped (or the repository is private so `raw.githubusercontent.com` URLs 404) | Use absolute URLs that are publicly reachable; otherwise keep README text-only. |
| Repository / homepage link 404s on npmjs.com | `repository` points at a private or non-existent GitHub repository | Make the repository public or fix `repository`/`homepage`/`bugs` before publishing. |
