# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The plugin version is
independent of the DeepSeek Harness version it supports; see `engines.dsh` in `package.json` for the
supported Harness range.

## [Unreleased]

## [0.3.0] - 2026-10-27

First public release. One npm package (`notix-dsh`) contains both the Host plugin and the browser
settings card; the separate `notix-dsh-ui` package is no longer used.

### Added

- **Native Windows notifications.** A `windows-system` channel posts WinRT `ToastNotification`s
  through Windows PowerShell 5.1 and the bundled `toast.ps1` helper: Action Center banners
  attributed to **Notix** with the whale icon (per-user `AppUserModelId` registration), optional
  sound, click-to-open through protocol activation, and dedupe-key based toast replacement.
- **Windows settings fields.** `channels.windows.appId` and `channels.windows.icon` are configurable
  in the settings card and the profile YAML, alongside `enabled`, `sound`, `clickToOpen` and
  `baseUrl`.
- **Modular cross-platform channel layer.** A shared `SystemChannel` base (`channels/base.js`), a
  common process runner/resource lookup (`channels/shared.js`), a built-in registry that maps
  `process.platform` to exactly one adapter (`darwin → macos`, `win32 → windows`), and one adapter
  per platform. Only the channel for the running platform is ever registered.
- **Packaging and release pipeline.** The npm tarball is runtime-only (`lib/`, runtime assets,
  `locale/`, `cordis.patch.yml`, `icon.png`, both READMEs, `LICENSE`) plus the macOS helper build
  inputs; `prepack` rebuilds `lib/` and `prepublishOnly` runs the full verification gate.
- **Documentation.** Rewritten English and Chinese READMEs with platform matrix, install paths,
  delivery architecture, configuration reference and troubleshooting; a development guide, a
  publishing runbook and a test plan/report.
- **CI and repository hygiene.** A `verify` GitHub Actions workflow (Node 22 and 24), Dependabot for
  npm and Actions, issue/PR templates, security policy and code of conduct.

### Changed

- The macOS channel is rebuilt on the shared channel base: helper app → `terminal-notifier` →
  `alerter` → `osascript`, with the resolved backend cached and a failed detection retried on the
  next notification.
- Notification delivery is isolated per channel: 10 s timeout per attempt, retries with
  1 s / 5 s / 15 s backoff, and a five-minute circuit breaker after three consecutive failures.
- Job-level notifications remain opt-in (`triggers.longTask.jobs` and `triggers.completion.jobs`
  default to `false`).

### Fixed

- Notification content never includes command lines or file contents; `verbosity: normal` only adds
  a truncated error message.
- The Windows helper stays ASCII-only so PowerShell 5.1 decodes it correctly, and all user-supplied
  text is XML-escaped before it reaches the toast XML.

## 0.2.0 - 2026-10-24

Internal single-package snapshot; never published to npm. `0.3.0` is the first npm release.

### Added

- Single-package distribution: the Host plugin (`lib/index.js`) and the browser settings card
  (`lib/client.js`) ship together, discovered through `dsh.bundle.patch` and `dsh.client`.
- Triggers for approvals, pending questions, long turns and background jobs, errors and tool
  failures, and completions; each with an `enabled` switch, thresholds, reminders and quiet hours.
- Live-editable settings card on the Plugins page and under Settings → Plugins.
- macOS notification delivery with the signed helper app, `terminal-notifier`, `alerter` or
  `osascript`; notification history and `ctx.notix` service API.

[Unreleased]: https://github.com/QiangXian/notix-dsh/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/QiangXian/notix-dsh/releases/tag/v0.3.0
