# Contributing to Notix

Thanks for taking a look. Notix is a small, focused plugin: desktop notifications for DeepSeek
Harness (macOS and Windows), plus the settings card that configures them. It is a **pure observer** —
it never answers approvals, never appends session events and never blocks the agent loop. Please keep
changes inside that boundary.

## Before you start

- Use Node.js `^22.18.0 || >=24.0.0` and pnpm `10.26.2` (pinned by `package.json`'s `packageManager`).
- Read the [development guide](docs/DEVELOPMENT.md) — it documents the source layout, the build
  pipeline, the channel-adapter design and the DSH module boundary.
- For anything larger than a bug fix, open an issue first so the design can be agreed before code
  is written.

## Local workflow

```bash
pnpm install --frozen-lockfile
pnpm build          # regenerate the complete lib/ tree from src/
pnpm test           # unit/integration/package tests (rebuilds lib/ first)
pnpm smoke          # Client bundle contract smoke test
pnpm verify         # test + smoke + full-tree reproducibility check (run before a PR)
```

`pnpm notify-test` (macOS) and `pnpm notify-test:win` (Windows) post one real OS notification through
the built channel; they are manual checks and are never part of `pnpm test`.

## Ground rules

- **Edit `src/`, never `lib/`.** `lib/` is generated in full by `node scripts/build.mjs`; only
  `src/host/**` and `src/client/**` are hand-written.
- **Never commit `lib/`, `build/` or `.tmp/`.** They are ignored by Git; a clean checkout starts
  without generated artifacts.
- **Keep `src/host/channels/toast.ps1` ASCII-only.** The build copies it byte-for-byte and Windows
  PowerShell 5.1 would otherwise decode it with the ANSI code page.
- **Isolate platforms through `BUILTIN_CHANNELS`.** Platform-specific code must be reachable only via
  the registry entry for its `process.platform`, so a macOS Host never spawns Windows tooling and
  vice versa.
- **No network calls, no session writes, no approval/answerer registration.** Delivery failures are
  contained by the channel registry's retry and circuit breaker; they must never propagate.
- **Keep notification content minimal.** Bodies default to the session title, tool name and a
  truncated question/reason; never log or notify command lines, file contents or secrets.
- **Add tests with behaviour changes.** Channel behaviour, triggers, config normalization and the
  packaging contract all have tests; extend them instead of relying on manual checks.

## Pull requests

- Keep the change focused; one concern per PR.
- Run `pnpm verify` and make sure it passes (CI runs the same gate on Node 22 and 24).
- Update the README and `docs/` when behaviour or configuration changes; both READMEs must stay in
  sync (`README.md` and `README.zh.md`).
- Do not bump the version or edit the `files` allowlist in a feature PR — releases are cut by the
  maintainer, following [docs/PUBLISHING.md](docs/PUBLISHING.md).

The PR template lists the checklist; the issue templates ask for the environment details that are
needed to reproduce notification problems.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
