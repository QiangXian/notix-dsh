# Notix for DeepSeek Harness

**Notix** tells you when the agent needs input, runs too long, fails, or finishes — desktop notifications for [dsh](https://github.com/deepseek-ai/deepseek-harness).

```
packages/
├── notix-dsh/       Host plugin: event triggers, rules, channels, macOS delivery
└── notix-dsh-ui/    Browser plugin: Settings → Plugins card for thresholds and channels
docs/
└── ui-settings-design.md
DESIGN.md            Design document (reviewed v1.1)
dev/notix.patch.yml  Try the checkout without installing it
```

## Quick start

```bash
pnpm install
pnpm test
pnpm notify-test   # send one real macOS notification through the channel adapter

# try the Host plugin against a stock profile without installing
dsh --profile web --patch ./dev/notix.patch.yml --dump-config

# install into a profile
dsh plugin --profile web add /absolute/path/to/packages/notix-dsh
```

See [packages/notix-dsh/README.md](packages/notix-dsh/README.md) for configuration, the service API, and security notes; [DESIGN.md](DESIGN.md) for the design rationale and event-surface facts.

## Design in one paragraph

Notix is a **pure observer**. It subscribes globally to `session/event` (`approval/asked|decided`, `turn/*`, `tool/result`, `job/*`), the `userQuestions` session projection, and `agent/error`, and never registers a waterfall answerer nor appends session events. Triggers feed a pipeline — rules → dedupe → cooldown → quiet hours → localized render → serialized delivery queue — into a channel registry whose v1 adapter delivers macOS notifications through `osascript` (with `terminal-notifier`/`alerter` for click-to-open when available). History and dedupe state live in the `notix` storage domain. Delivery failures are contained by retries and per-channel circuit breakers and never reach the agent loop.
