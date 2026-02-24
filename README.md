# openclaw-self-healing

OpenClaw plugin that improves resilience by automatically fixing reversible failures.

## What it can heal (v0.1)

- Detect rate limit / quota / auth-scope failures
- Put the affected model into cooldown
- Patch pinned session model overrides to a safe fallback (prevents endless `API rate limit reached` loops)

## Install (dev)

```bash
openclaw plugins install -l ~/.openclaw/workspace/openclaw-self-healing
openclaw gateway restart
```

## Config

```json
{
  "plugins": {
    "entries": {
      "openclaw-self-healing": {
        "enabled": true,
        "config": {
          "modelOrder": [
            "anthropic/claude-opus-4-6",
            "openai-codex/gpt-5.2",
            "google-gemini-cli/gemini-2.5-flash"
          ],
          "cooldownMinutes": 300,
          "autoFix": {
            "patchSessionPins": true,
            "disableFailingPlugins": false,
            "disableFailingCrons": false
          }
        }
      }
    }
  }
}
```

## Notes

Infrastructure changes remain ask-first.
