# STATUS.md — openclaw-self-healing-elvatis

_Last updated: 2026-03-08 by Akido (claude-sonnet-4-6)_

## Current Version: 0.2.10 — STABLE

## What is done

- ✅ Repo: `https://github.com/elvatis/openclaw-self-healing-elvatis`
- ✅ npm: `@elvatis_com/openclaw-self-healing-elvatis@0.2.10`
- ✅ ClawHub: `openclaw-self-healing-elvatis@0.2.10`
- ✅ Model failover: rate-limit + auth-scope cooldown, configurable fallback order
- ✅ WhatsApp reconnect: disconnect streak detection + gateway restart
- ✅ Cron failure: consecutive fail threshold → disable + GitHub issue
- ✅ Plugin health monitoring: `openclaw plugins list --json` → auto-disable on crash/error
- ✅ Config guardrails: never modify/restart if `openclaw.json` is invalid JSON
- ✅ Startup config validation (fail-fast)
- ✅ Status snapshot: written to file on every tick for external monitoring
- ✅ Active recovery probing: polls limited models to detect early recovery
- ✅ Dry-run mode: full behavior simulation without side effects
- ✅ Backup path: `~/.openclaw/backups/openclaw.json/openclaw.json.<timestamp>.bak`

## Backup Behavior

The plugin creates timestamped backups before any action that could restart the gateway
or change cron/plugin state. Backups are written to:
`~/.openclaw/backups/openclaw.json/openclaw.json.<ISO-timestamp>.bak`

Note: Files like `openclaw.json.bak` in `~/.openclaw/` are from the manual config-change
checklist procedure, not from this plugin.

## Open Risks

- ClawHub publish ignores `.clawhubignore` — use rsync workaround (see CONVENTIONS.md)
