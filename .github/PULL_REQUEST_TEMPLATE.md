## Summary

<!-- What does this change and why? Link the issue it closes: "Closes #123". -->

## Type of change

- [ ] Bug fix
- [ ] New trigger / channel / configuration option
- [ ] Documentation
- [ ] Build, packaging or CI
- [ ] Refactor (no behaviour change)

## How it was tested

<!-- Commands run and manual checks performed, e.g. `pnpm verify`, `pnpm notify-test:win`. -->

## Checklist

- [ ] `pnpm verify` passes (CI runs the same gate on Node 22 and 24).
- [ ] Hand-written changes are in `src/`; `lib/` was rebuilt by the build and is **not** committed.
- [ ] `src/host/channels/toast.ps1` stays ASCII-only (if touched).
- [ ] Platform-specific behaviour is reached only through `BUILTIN_CHANNELS` (if a channel changed).
- [ ] Notix still never answers approvals, appends session events or blocks the agent loop.
- [ ] `README.md` and `README.zh.md` are updated together when behaviour or configuration changed.
- [ ] Tests cover the new behaviour, and docs/`DEVELOPMENT.md` is updated if the architecture moved.
- [ ] No version bump or `files` allowlist change (those belong to a release PR).
