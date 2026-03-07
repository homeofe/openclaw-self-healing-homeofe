# NEXT_ACTIONS.md — openclaw-self-healing-elvatis

_Last updated: 2026-03-07_

## Status Summary

| Status | Count |
|--------|-------|
| Done   | 15    |
| Ready  | 1     |
| Blocked | 0   |

---

## Ready — Work These Next

### T-014: [medium] — Export heal metrics to `~/.aahp/metrics.jsonl`
- **Goal:** Append one JSONL line per heal event for analysis and alerting.
- **Context:** Heal events are only visible in logs and via `api.emit()`. No persistent record for analysis.
- **What to do:**
  - Export `appendMetric(line, metricsFile)` helper
  - Write entries for: `model-cooldown`, `session-patched`, `whatsapp-restart`, `cron-disabled`, `model-recovered`
  - Default metrics file: `~/.aahp/metrics.jsonl` (configurable via `metricsFile`)
  - Skip or mark dry-run events
  - Create parent directory if missing
- **Files:** `index.ts`, `test/index.test.ts`, `README.md`
- **Definition of done:** Helper exported and tested; all 5 event types write metrics; README documents format.
- **GitHub Issue:** #12

---

## Recently Completed

| Task | Title | Date |
|------|-------|------|
| T-015 | Fix infinite gateway restart loop | 2026-03-07 |
| T-005 | Plugin health monitoring via JSON API | 2026-03-07 |
| T-013 | Status snapshot file on each monitor tick | 2026-03-02 |
| T-012 | Startup config validation (fail-fast) | 2026-03-02 |
| T-011 | Integration tests for monitor tick flows | 2026-03-02 |
| T-004 | TypeScript build pipeline + typecheck | 2026-03-01 |
| T-010 | Observability events + status endpoint | 2026-02-28 |
| T-009 | Dry-run mode | 2026-02-28 |
| T-008 | Active recovery probing | 2026-02-28 |
| T-007 | Config hot-reload | 2026-02-28 |
