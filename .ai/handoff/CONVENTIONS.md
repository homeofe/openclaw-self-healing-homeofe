# CONVENTIONS.md — openclaw-self-healing-elvatis

## Language & Runtime
- TypeScript strict mode, ESM (`"type": "module"`)
- Node 16 module resolution (`"moduleResolution": "Node16"`)
- Target: ES2022

## Package
- Scope: `@elvatis_com/openclaw-self-healing-elvatis`
- Plugin ID: `openclaw-self-healing-elvatis`
- Test runner: vitest

## File Layout
```
.ai/handoff/         ← AAHP protocol files (this folder)
src/                 ← (future) extracted helpers
index.ts             ← plugin entry point + all business logic
test/                ← vitest test suites
openclaw.plugin.json ← manifest
package.json / tsconfig.json / tsconfig.check.json
scripts/             ← one-off utilities (roadmap issue creation, etc.)
```

## Code Style
- Named exports for all pure helpers (testable without plugin API)
- `saveState()` must be called BEFORE any destructive system call (e.g. `openclaw gateway restart`)
  → Reason: systemd-managed gateway restarts kill the process mid-execution; state written after the call is never persisted
- No secrets in logs — redact with `[REDACTED]`
- `runCmd` always uses `bash -lc` for login shell compatibility
- All `autoFix.*` flags default to the safest value (`false` unless stated otherwise)
- `whatsappRestartEnabled` is the one exception — defaults to `true` (most useful default)

## Release Checklist (mandatory for every publish)

### Before release
1. `npm run typecheck` — must pass
2. `npm test` — all tests must pass
3. Bump version in `package.json` AND `openclaw.plugin.json`

### Publish (all three platforms, no exceptions)
4. `git tag vX.Y.Z && git push origin main && git push origin vX.Y.Z`
5. `gh release create vX.Y.Z --title "..." --notes "..."`
6. `npm publish --access public`
7. ClawHub (use rsync workaround — `.clawhubignore` is NOT respected by `clawhub publish`):
   ```bash
   TMP=$(mktemp -d)
   rsync -a --exclude='node_modules' --exclude='.git' --exclude='dist' \
     --exclude='package-lock.json' ./ "$TMP/"
   clawhub publish "$TMP" --slug openclaw-self-healing-elvatis \
     --name "OpenClaw Self Healing" --version X.Y.Z --changelog "..." --no-input
   rm -rf "$TMP"
   ```

### After release
8. Update ALL docs in this repo: STATUS.md, DASHBOARD.md, LOG.md, NEXT_ACTIONS.md, README.md, SKILL.md
9. Update MEMORY.md on server if architecture decisions changed

## Documentation Rule (MANDATORY)
**Every release MUST update the following files before committing:**
- `.ai/handoff/STATUS.md` — current version, state, open risks
- `.ai/handoff/DASHBOARD.md` — task table
- `.ai/handoff/LOG.md` — append entry for this session
- `.ai/handoff/NEXT_ACTIONS.md` — move done tasks, add new ones
- `README.md` — version number + any changed behavior
- `SKILL.md` — if commands or config changed

Skipping documentation = incomplete release. No exceptions.
