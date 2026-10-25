# notix-dsh

[中文](README.zh.md) | English

Desktop notifications for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): tell me when the agent **needs input**, **runs too long**, **fails**, or **finishes**.

Notix is a pure observer. It never registers an approval/answerer, never appends session events, and never blocks the agent loop. It watches the shared event surfaces and delivers notifications through a pluggable channel registry (macOS system notifications in v1).

## One package, two runtime halves

This project publishes only `notix-dsh`; there is no separate `notix-dsh-ui` package to install. Its manifest combines `dsh.bundle.patch` and `dsh.client`:

- `lib/index.js` is the Node/Host entry: event triggers, rules, delivery channels, history, configuration and the `ctx.notix` service.
- `lib/client.js` is the browser entry: the Notix card on the Plugins and Settings → Plugins pages.
- `cordis.patch.yml` creates one Loader entry, `id: notix`. That entry loads the Host half and lets the Client loader discover this package's `dsh.client` declaration.

The two halves retain their own runtime lifecycles; only packaging and installation are merged.

## What it watches

| Trigger | Source | Default |
|---|---|---|
| Approval requested | `approval/asked` / `approval/decided` session events | on, 5 min reminder ×2 |
| Question waiting | `userQuestions` session projection (per-session busy tracking) | on, 5 min reminder |
| Long turn | `turn/start` watchdog | on, 10 min |
| Long background job | `job/registered` watchdog | off by default, 15 min when enabled (opt-in) |
| Turn failed | `turn/end` reason `error` + `agent/error` (deduped) | on, 60 s cooldown |
| Tool failure | `tool/result` with `isError` | off (opt-in) |
| Turn completed | `turn/end` reason `completed` | on, ≥3 min turns |
| Job settled | `job/settled` | off by default (opt-in) |

Deliveries are deduped, error notifications are cooled down per session, silenced during quiet hours, and retried with a circuit breaker per channel. Notification history (last 200) is kept in the `notix` storage domain and exposed as `ctx.notix.history()`.

## What it looks like on macOS

The `osascript` channel shows a standard notification banner (bold title + body, floating card at the top-right):

![macOS notification banner](docs/assets/macos-notification-banner.png)

⚠️ The icon on the left is assigned by macOS to the sending process: with `osascript` it is the system **Script Editor** icon, not Notix's own icon (the Notix icon is used for the dsh plugin list/market):

![Script Editor icon](docs/assets/macos-notification-icon.png)

### Show the whale icon in the banner (signing required)

macOS only authorizes code-signed apps for notifications; ad-hoc or unsigned bundles are rejected before any permission prompt appears (`requestAuthorization` returns denied). Build and sign the bundled helper:

```bash
NOTIX_SIGN_IDENTITY="Apple Development: Your Name (TEAMID)" \
  ./scripts/build-notifier-app.sh --install
```

Click **Allow** on the first notification; afterwards the banner shows the Notix whale icon. Without a signing identity the script falls back to ad-hoc and prints a warning. An installed ad-hoc helper is still selected at runtime and notification delivery fails authorization; remove or disable that helper, or rebuild it with a valid identity. When `terminal-notifier` is installed, the plugin also passes the bundled icon with `-appIcon`.

## Requirements

- DeepSeek Harness `>=0.2.1-rc.2 <0.3.0`
- macOS for the built-in `macos-system` channel (uses `osascript`; `terminal-notifier` and `alerter` are used when present, but only `terminal-notifier` supports click-to-open)

## Install

From the Web GUI sidebar **Plugins** page, install this package (the GUI updates the active profile and selects the bundle for you), or use the CLI. The profile depends on how DSH runs:

- **Desktop app** (`~/.dsh/profiles/desktop`): open the app once so the profile exists, then **quit it** — the CLI refuses to modify the desktop profile while the app is running.

  ```bash
  dsh plugin --profile desktop add notix-dsh
  ```

- **`dsh web` / browser GUI** (`~/.dsh/profiles/web`):

  ```bash
  dsh plugin --profile web add notix-dsh
  ```

After a CLI install, confirm the package is listed in the profile's `dsh.profile.bundles`, then restart that DSH instance. A `link:` install is handy during development:

```bash
# desktop: quit the app first
dsh plugin --profile desktop add link:/absolute/path/to/notix-dsh
# web
dsh plugin --profile web add link:/absolute/path/to/notix-dsh
```

```jsonc
// ~/.dsh/profiles/<name>/package.json
{
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "notix-dsh"] } }
}
```

## Settings UI

The settings UI is included in this package. After the Web GUI reloads, open **Plugins** or **Settings → Plugins** to edit triggers, thresholds, quiet hours, notification content and the macOS channel. Changes are written through `configForms` and applied to the running Host plugin without a second installation.

When upgrading from the split packages, do not enable the legacy `notix-dsh-ui` alongside this release. Keep only one Notix bundle source in the profile; existing configuration under `id: notix` remains compatible.

## Configuration

Every field is optional; shipped defaults apply. Override in the profile's `cordis.patch.yml` under the same entry id:

```yaml
# ~/.dsh/profiles/<name>/cordis.patch.yml
- id: notix
  name: notix-dsh
  config:
    triggers:
      longTask: { turnThresholdMs: 300000 }
      error: { toolErrors: true, toolTimeout: true }
    quietHours: { enabled: true, from: "23:00", to: "08:00", allowUrgent: true }
    channels:
      macos: { sound: false }
```

| Field | Default | Meaning |
|---|---|---|
| `language` | `zh` | Notification language (`zh` / `en`) |
| `verbosity` | `minimal` | `minimal` omits command/file contents |
| `triggers.approval.remindAfterMs` | `300000` | Reminder delay while an approval stays unanswered |
| `triggers.approval.maxReminders` | `2` | Reminder cap |
| `triggers.userQuestion.remindAfterMs` | `300000` | Reminder delay while a question stays open |
| `triggers.userQuestion.maxReminders` | `2` | Reminder cap |
| `triggers.userQuestion.remindOnContinued` | `true` | Re-notify when a timed question becomes pending |
| `triggers.longTask.turnThresholdMs` | `600000` | Turn watchdog threshold |
| `triggers.longTask.jobs` | `false` | Watch background jobs too (off by default) |
| `triggers.longTask.jobThresholdMs` | `900000` | Background job watchdog threshold |
| `triggers.error.cooldownMs` | `60000` | Per-session error notification cooldown |
| `triggers.error.toolErrors` | `false` | Notify on failed tool results |
| `triggers.error.toolTimeout` | `false` | Notify on `TOOL_TIMEOUT` specifically |
| `triggers.completion.minDurationMs` | `180000` | Only long turns announce completion |
| `triggers.completion.jobs` | `false` | Announce settled background jobs (off by default) |
| `quietHours` | off | Empty window rules; `allowUrgent` lets approvals/questions through |
| `channels.macos.baseUrl` | `""` | GUI URL opened by click-to-open helpers |
| `channels.macos.notifierApp` | `""` → `~/Applications/Notix.app` | Notification helper app bundle |
| `channels.macos.appIcon` | `""` → bundled whale icon | Banner icon passed to terminal-notifier |

## Service API

Other plugins can use `ctx.notix`:

```js
ctx.notix.notify({ title: 'Deploy done', body: 'main is green', urgency: 'normal' })
ctx.notix.registerChannel({ id: 'my-channel', send: async (notification) => { /* ... */ } })
ctx.notix.history(20)
```

## Security and privacy

- Notification bodies default to session title, tool name, and a truncated question/reason; they never include full command lines or file contents. `verbosity: normal` only adds a truncated error message, not full command output.
- The plugin never decides anything: approvals keep their fail-closed semantics, and all decisions stay in the GUI.
- Delivery failures are contained: retries and per-channel circuit breakers, and no error ever reaches the agent loop.

## Development

All hand-written code lives in `src/host/` and `src/client/`. `lib/` is generated in full and ignored by Git; do not edit or commit it.

```bash
pnpm install --frozen-lockfile
pnpm build          # clean and rebuild the complete lib/ tree
pnpm build:check    # temp-build and compare every generated file with lib/
pnpm test           # build first, then run unit/integration/package tests
pnpm smoke          # verify the browser bundle id and export contract
pnpm verify         # test + smoke + full-tree reproducibility check
cp dev/notix.patch.example.yml dev/notix.patch.local.yml   # once: create the ignored local overlay
dsh --profile web --patch ./dev/notix.patch.local.yml --dump-config
```

See the [development guide](docs/DEVELOPMENT.md) for the unified source layout, DSH module boundary, source-map guarantees and release workflow.

`dev/notix.patch.example.yml` is the tracked template; copy it to `dev/notix.patch.local.yml` and point `name` at the absolute path of this checkout to load it without installing. The local copy is ignored by Git (`dev/*.local.yml`), so moving the repository only requires editing that one file. Run `pnpm build` before starting DSH so the generated entry files exist.
