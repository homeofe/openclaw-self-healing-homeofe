# NEXT_ACTIONS (AAHP)

## Status Summary

| Status  | Count |
|---------|-------|
| Done    | 10    |
| Ready   | 0     |
| Blocked | 1     |

---

## Ready - Work These Next

No tasks are currently ready. All remaining work is blocked on external dependencies.

---

## Blocked

### T-005 [high] - Implement structured plugin health monitoring and auto-disable
- **Blocked by:** Waiting for `openclaw plugins list --json` API from openclaw core
- **Goal:** Monitor plugin health and auto-disable failing plugins using structured JSON output.
- **Context:** Current code has a stub that parses plain text output from `openclaw plugins list`. No robust parsing is possible without the `--json` flag.
- **What to do (when unblocked):**
  - Parse `openclaw plugins list --json` output for plugin status
  - Auto-disable plugins with `status=error` (respecting `pluginDisableCooldownSec`)
  - Create GitHub issues for disabled plugins
- **Files:** `index.ts`, `test/index.test.ts`
- **Definition of done:** Failing plugins are detected via JSON API and auto-disabled; tests cover detection and disable logic.
- **GitHub Issue:** #3

---

## Recently Completed

| Task  | Title | Date |
|-------|-------|------|
| T-010 | Expose self-heal status for external monitoring | 2026-02-28 |
| T-009 | Emit structured observability events for heal actions | 2026-02-28 |
| T-008 | Add dry-run mode for safe validation of healing logic | 2026-02-28 |
| T-007 | Add active model recovery probing to shorten cooldown periods | 2026-02-28 |
| T-006 | Support configuration hot-reload without gateway restart | 2026-02-28 |
