# Security policy

Notix is a local-only DeepSeek Harness plugin. It never makes network requests, never answers
approvals and never writes to the session log; it observes events and spawns local OS notification
tools (`osascript`, `terminal-notifier`, `alerter`, `powershell.exe`).

## Supported versions

| Version | Supported |
| --- | --- |
| `0.3.x` | ✅ current release line |
| `< 0.3.0` | ❌ no longer maintained |

Only the latest published version receives fixes. The published package is the runtime artifact set;
security fixes ship as a new patch release.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting: open
[Security → Report a vulnerability](https://github.com/QiangXian/notix-dsh/security/advisories/new),
or the **Report a vulnerability** button on the repository's Security tab.

Please include:

- the affected `notix-dsh` version and the DSH version;
- the platform and install method (`dsh plugin add`, `link:` checkout, GUI install);
- what an attacker can do and what they need (a crafted notification payload, a malicious session
  title, a config value, a second plugin, local access, …);
- reproduction steps or a proof of concept.

Reports are acknowledged and triaged as soon as possible; please allow a reasonable window before
public disclosure, and coordinate the disclosure date with the maintainers.

## Scope

Security-relevant areas of this plugin:

- **Command construction.** Delivery spawns external tools through `execFile`-style calls with
  argument arrays, `windowsHide`, a bounded timeout and a capped output buffer — never a shell.
  Windows payloads travel through `NOTIX_*` environment variables, and the PowerShell helper
  XML-escapes every user-supplied value. Anything that lets notification text, a session title, a
  question body or a config value break out of those boundaries is in scope.
- **macOS helper app.** `Notix.app` is built from `scripts/notifier/NotixNotifier.swift` and
  code-signed by the user; an unsigned or ad-hoc helper is rejected by macOS. Anything that makes
  the plugin execute a different binary than the configured/expected helper is in scope.
- **Configuration and settings card.** Configuration is written through the profile's
  `cordis.patch.yml`; the card can only mutate the `notix` config namespace.
- **`ctx.notix` service.** `registerChannel()` accepts adapters from other plugins in the same Host
  process. That is an intentional same-process capability, not a sandbox boundary; a malicious
  plugin already runs with the Host's privileges.
- **Local state.** Notification history and dedupe keys live in the `notix` storage domain; the
  Windows channel writes only the per-user `HKCU\Software\Classes\AppUserModelId` key.
- **Path handling.** Icon, helper-app and notification-helper configuration values are read as
  paths; template/asset lookups must stay inside the package.

## Not a vulnerability

- Notifications being suppressed by Focus / Do Not Disturb / OS notification settings, or by
  `quietHours`, dedupe and error cooldowns — that is designed behaviour.
- Notification bodies containing the session title, tool name and a truncated question/error
  message — the content limits are documented in the README.
- Missing notifications on Linux or any platform without a registered channel — expected; the plugin
  logs that no channel exists.
- Needing OS notification permission or a valid code-signing identity for the macOS helper — a
  platform requirement, not a flaw.

## Dependency and supply-chain hygiene

- `pnpm-lock.yaml` locks the dependency tree; CI runs `pnpm install --frozen-lockfile`.
- `lib/` is generated from `src/` by `prepack` on publish; the published tarball is limited to the
  runtime artifacts (plus the macOS helper build inputs) and reviewed with `npm pack --dry-run`.
- Dependabot keeps npm and GitHub Actions dependencies current.
