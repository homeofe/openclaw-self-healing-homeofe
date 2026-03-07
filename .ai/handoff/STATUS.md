# STATUS.md — openclaw-self-healing-elvatis

_Last updated: 2026-03-07 by Akido (claude-sonnet-4-6)_

## Current Version: 0.2.8 — STABLE

## What is done

- ✅ Repo: `https://github.com/elvatis/openclaw-self-healing-elvatis`
- ✅ npm: `@elvatis_com/openclaw-self-healing-elvatis@0.2.8`
- ✅ ClawHub: `openclaw-self-healing-elvatis@0.2.8`
- ✅ Model failover: rate-limit + auth-scope cooldown, configurable fallback order
- ✅ WhatsApp reconnect: disconnect streak detection + gateway restart
- ✅ Cron failure: consecutive fail threshold → disable + GitHub issue
- ✅ Plugin health monitoring: `openclaw plugins list --json` → auto-disable on crash/error
- ✅ Config guardrails: never modify/restart if `openclaw.json` is invalid JSON
- ✅ Startup config validation (fail-fast)
- ✅ Status snapshot: written to file on every tick for external monitoring
- ✅ Active recovery probing: polls limited models to detect early recovery
- ✅ Dry-run mode: full behavior simulation without side effects
- ✅ Config hot-reload: reads `api.pluginConfig` on each tick
- ✅ Atomic state writes: tmp file + rename to avoid partial writes
- ✅ 181 tests across 2 suites (unit + integration)
- ✅ TypeScript build + typecheck pipeline
- ✅ `.clawhubignore` + rsync-based ClawHub publish documented in CONVENTIONS.md

## Critical Bug Fixed (v0.2.8)

**Infinite gateway restart loop** — `lastRestartAt` was being saved AFTER
`openclaw gateway restart`, which kills the process via systemd. On the next
boot, `lastRestartAt = 0`, bypassing the `whatsappMinRestartIntervalSec`
rate-limit guard. Fixed by saving state BEFORE the restart call.

## Open Risks

- `T-014`: Heal metrics export to JSONL not yet implemented (low priority, no blocker)
- ClawHub publish via `clawhub publish <dir>` ignores `.clawhubignore` — use rsync workaround (see CONVENTIONS.md)
