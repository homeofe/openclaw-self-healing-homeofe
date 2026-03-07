# LOG.md — openclaw-self-healing-elvatis

## 2026-03-07 — Session (Akido / claude-sonnet-4-6)

**Bug: Infinite gateway restart loop (fixed in v0.2.8)**

Root cause: `openclaw gateway restart` kills the process via systemd. `lastRestartAt = nowSec()`,
`disconnectStreak = 0`, and `saveState()` were placed AFTER `runCmd("openclaw gateway restart")`.
These lines never executed when the process was killed. On next boot, `lastRestartAt = 0`,
`since = huge`, bypassing the 5-minute rate-limit guard. WhatsApp takes 60–120s to reconnect
after any restart → self-healing saw 2 disconnect ticks → hit threshold → restarted again.
Infinite loop.

Fix: moved `lastRestartAt = nowSec()`, `disconnectStreak = 0`, and `saveState()` to BEFORE
the `runCmd("openclaw gateway restart")` call.

**Release pipeline:**
- v0.2.8 committed, tagged, pushed to GitHub
- GitHub release created: https://github.com/elvatis/openclaw-self-healing-elvatis/releases/tag/v0.2.8
- npm published: `@elvatis_com/openclaw-self-healing-elvatis@0.2.8`
- ClawHub published: `openclaw-self-healing-elvatis@0.2.8` (rsync workaround — .clawhubignore not respected by clawhub publish)
- Added `.clawhubignore` and documented rsync workaround in CONVENTIONS.md

All 181 tests passed before release.

---

## 2026-03-02 — Session (Akido)

- T-013: Status snapshot file written on each monitor tick
- T-012: Startup config validation with fail-fast
- T-011: Integration tests for monitor service tick flows
- T-005: Plugin health monitoring implemented via `openclaw plugins list --json`
- Atomic state writes (tmp + rename)

---

## 2026-03-01 — Session (Akido)

- T-004: TypeScript build pipeline + typecheck

---

## 2026-02-28 — Session (Akido)

- T-010: Self-heal status endpoint / observability events
- T-009: Dry-run mode
- T-008: Active recovery probing
- T-007: Config hot-reload

---

## 2026-02-27 — Session (Akido)

- Defined v0.3 roadmap with 8 items. Created ROADMAP.md + scripts/create-roadmap-issues.sh.
- GitHub issue creation deferred (gh CLI not authenticated at the time).

---

## 2026-02-24 — Session (Akido)

- Initialized AAHP handoff structure.
