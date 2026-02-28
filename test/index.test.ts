import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  expandHome,
  nowSec,
  loadState,
  saveState,
  isRateLimitLike,
  isAuthScopeLike,
  pickFallback,
  patchSessionModel,
  safeJsonParse,
  parseConfig,
  configDiff,
  type State,
  type PluginConfig,
} from "../index.js";
import register from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "self-heal-test-"));
}

function emptyState(): State {
  return {
    limited: {},
    pendingBackups: {},
    whatsapp: {},
    cron: { failCounts: {}, lastIssueCreatedAt: {} },
    plugins: { lastDisableAt: {} },
  };
}

function mockApi(overrides: Record<string, any> = {}) {
  const handlers: Record<string, Function[]> = {};
  const services: any[] = [];

  return {
    pluginConfig: overrides.pluginConfig ?? {},
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    on(event: string, handler: Function) {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
    },
    registerService(svc: any) {
      services.push(svc);
    },
    runtime: {
      system: {
        runCommandWithTimeout: vi.fn().mockResolvedValue({
          exitCode: 1,
          stdout: "",
          stderr: "not available",
        }),
      },
    },
    // test helpers
    _handlers: handlers,
    _services: services,
    _emit(event: string, ...args: any[]) {
      for (const h of handlers[event] ?? []) h(...args);
    },
  };
}

// ---------------------------------------------------------------------------
// expandHome
// ---------------------------------------------------------------------------

describe("expandHome", () => {
  it("returns empty string for empty input", () => {
    expect(expandHome("")).toBe("");
  });

  it("expands bare tilde to homedir", () => {
    expect(expandHome("~")).toBe(os.homedir());
  });

  it("expands ~/path to homedir/path", () => {
    expect(expandHome("~/foo/bar")).toBe(path.join(os.homedir(), "foo/bar"));
  });

  it("returns absolute paths unchanged", () => {
    expect(expandHome("/usr/local/bin")).toBe("/usr/local/bin");
  });

  it("returns relative paths unchanged", () => {
    expect(expandHome("relative/path")).toBe("relative/path");
  });
});

// ---------------------------------------------------------------------------
// nowSec
// ---------------------------------------------------------------------------

describe("nowSec", () => {
  it("returns current time in seconds (integer)", () => {
    const before = Math.floor(Date.now() / 1000);
    const result = nowSec();
    const after = Math.floor(Date.now() / 1000);
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
    expect(Number.isInteger(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isRateLimitLike
// ---------------------------------------------------------------------------

describe("isRateLimitLike", () => {
  it("returns false for undefined", () => {
    expect(isRateLimitLike(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isRateLimitLike("")).toBe(false);
  });

  it("returns false for unrelated error", () => {
    expect(isRateLimitLike("connection timeout")).toBe(false);
  });

  it.each([
    "Rate limit exceeded",
    "RATE LIMIT reached",
    "quota exceeded for project",
    "HTTP 429 Too Many Requests",
    "resource_exhausted: try again later",
  ])("detects rate limit pattern: %s", (err) => {
    expect(isRateLimitLike(err)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isAuthScopeLike
// ---------------------------------------------------------------------------

describe("isAuthScopeLike", () => {
  it("returns false for undefined", () => {
    expect(isAuthScopeLike(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isAuthScopeLike("")).toBe(false);
  });

  it("returns false for unrelated error", () => {
    expect(isAuthScopeLike("connection refused")).toBe(false);
  });

  it.each([
    "HTTP 401 Unauthorized",
    "Insufficient permissions for resource",
    "Missing scopes: read:org",
    "api.responses.write is required",
    "unauthorized access to endpoint",
  ])("detects auth/scope pattern: %s", (err) => {
    expect(isAuthScopeLike(err)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// safeJsonParse
// ---------------------------------------------------------------------------

describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses JSON arrays", () => {
    expect(safeJsonParse("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("returns undefined for invalid JSON", () => {
    expect(safeJsonParse("{broken")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(safeJsonParse("")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// loadState / saveState
// ---------------------------------------------------------------------------

describe("loadState / saveState", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns default state when file does not exist", () => {
    const s = loadState(path.join(dir, "missing.json"));
    expect(s.limited).toEqual({});
    expect(s.pendingBackups).toEqual({});
    expect(s.whatsapp).toEqual({});
    expect(s.cron).toEqual({ failCounts: {}, lastIssueCreatedAt: {} });
    expect(s.plugins).toEqual({ lastDisableAt: {} });
  });

  it("round-trips state through save and load", () => {
    const p = path.join(dir, "state.json");
    const state: State = {
      limited: {
        "model-a": { lastHitAt: 100, nextAvailableAt: 200, reason: "rate limit" },
      },
      pendingBackups: {},
      whatsapp: { lastSeenConnectedAt: 50 },
      cron: { failCounts: { "job-1": 3 }, lastIssueCreatedAt: {} },
      plugins: { lastDisableAt: {} },
    };
    saveState(p, state);
    const loaded = loadState(p);
    expect(loaded.limited["model-a"].lastHitAt).toBe(100);
    expect(loaded.limited["model-a"].nextAvailableAt).toBe(200);
    expect(loaded.whatsapp?.lastSeenConnectedAt).toBe(50);
    expect(loaded.cron?.failCounts?.["job-1"]).toBe(3);
  });

  it("creates parent directories if they do not exist", () => {
    const p = path.join(dir, "nested", "deep", "state.json");
    saveState(p, emptyState());
    expect(fs.existsSync(p)).toBe(true);
  });

  it("fills missing sub-objects when loading partial state", () => {
    const p = path.join(dir, "partial.json");
    fs.writeFileSync(p, JSON.stringify({ limited: { x: { lastHitAt: 1, nextAvailableAt: 2 } } }));
    const s = loadState(p);
    expect(s.limited.x.lastHitAt).toBe(1);
    expect(s.pendingBackups).toEqual({});
    expect(s.whatsapp).toEqual({});
    expect(s.cron?.failCounts).toEqual({});
    expect(s.plugins?.lastDisableAt).toEqual({});
  });

  it("returns default state for corrupt JSON", () => {
    const p = path.join(dir, "corrupt.json");
    fs.writeFileSync(p, "{not valid json");
    const s = loadState(p);
    expect(s.limited).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// pickFallback
// ---------------------------------------------------------------------------

describe("pickFallback", () => {
  const models = ["model-a", "model-b", "model-c"];

  it("returns first model when none are limited", () => {
    expect(pickFallback(models, emptyState())).toBe("model-a");
  });

  it("skips a model whose cooldown has not expired", () => {
    const future = nowSec() + 9999;
    const state: State = {
      ...emptyState(),
      limited: {
        "model-a": { lastHitAt: nowSec(), nextAvailableAt: future },
      },
    };
    expect(pickFallback(models, state)).toBe("model-b");
  });

  it("returns first model if its cooldown has expired", () => {
    const past = nowSec() - 1;
    const state: State = {
      ...emptyState(),
      limited: {
        "model-a": { lastHitAt: 0, nextAvailableAt: past },
      },
    };
    expect(pickFallback(models, state)).toBe("model-a");
  });

  it("falls through to last model when all are limited", () => {
    const future = nowSec() + 9999;
    const state: State = {
      ...emptyState(),
      limited: {
        "model-a": { lastHitAt: nowSec(), nextAvailableAt: future },
        "model-b": { lastHitAt: nowSec(), nextAvailableAt: future },
        "model-c": { lastHitAt: nowSec(), nextAvailableAt: future },
      },
    };
    expect(pickFallback(models, state)).toBe("model-c");
  });

  it("skips multiple limited models to find available one", () => {
    const future = nowSec() + 9999;
    const state: State = {
      ...emptyState(),
      limited: {
        "model-a": { lastHitAt: nowSec(), nextAvailableAt: future },
        "model-b": { lastHitAt: nowSec(), nextAvailableAt: future },
      },
    };
    expect(pickFallback(models, state)).toBe("model-c");
  });

  it("handles single-model list", () => {
    expect(pickFallback(["only-model"], emptyState())).toBe("only-model");
  });
});

// ---------------------------------------------------------------------------
// patchSessionModel
// ---------------------------------------------------------------------------

describe("patchSessionModel", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("patches the model for an existing session key", () => {
    const p = path.join(dir, "sessions.json");
    fs.writeFileSync(p, JSON.stringify({ "sess-1": { model: "old-model" } }));

    const logger = { warn: vi.fn(), error: vi.fn() };
    const result = patchSessionModel(p, "sess-1", "new-model", logger);

    expect(result).toBe(true);
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    expect(data["sess-1"].model).toBe("new-model");
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("returns false when session key does not exist", () => {
    const p = path.join(dir, "sessions.json");
    fs.writeFileSync(p, JSON.stringify({ "sess-1": { model: "m" } }));

    const logger = { warn: vi.fn(), error: vi.fn() };
    const result = patchSessionModel(p, "nonexistent", "new-model", logger);

    expect(result).toBe(false);
  });

  it("returns false and logs error when file does not exist", () => {
    const p = path.join(dir, "no-file.json");
    const logger = { warn: vi.fn(), error: vi.fn() };
    const result = patchSessionModel(p, "sess-1", "new-model", logger);

    expect(result).toBe(false);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("preserves other session keys when patching", () => {
    const p = path.join(dir, "sessions.json");
    fs.writeFileSync(
      p,
      JSON.stringify({
        "sess-1": { model: "old" },
        "sess-2": { model: "keep" },
      })
    );

    patchSessionModel(p, "sess-1", "new", { warn: vi.fn(), error: vi.fn() });
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    expect(data["sess-2"].model).toBe("keep");
  });
});

// ---------------------------------------------------------------------------
// register - event handler integration tests
// ---------------------------------------------------------------------------

describe("register", () => {
  let dir: string;
  let stateFile: string;
  let sessionsFile: string;
  let configFile: string;

  beforeEach(() => {
    dir = tmpDir();
    stateFile = path.join(dir, "state.json");
    sessionsFile = path.join(dir, "sessions.json");
    configFile = path.join(dir, "openclaw.json");
    fs.writeFileSync(configFile, JSON.stringify({ valid: true }));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does nothing when enabled is false", () => {
    const api = mockApi({ pluginConfig: { enabled: false } });
    register(api);
    expect(Object.keys(api._handlers)).toHaveLength(0);
    expect(api._services).toHaveLength(0);
  });

  it("registers agent_end and message_sent handlers", () => {
    const api = mockApi({
      pluginConfig: {
        stateFile,
        sessionsFile,
        configFile,
        configBackupsDir: path.join(dir, "backups"),
      },
    });
    register(api);
    expect(api._handlers["agent_end"]).toHaveLength(1);
    expect(api._handlers["message_sent"]).toHaveLength(1);
  });

  it("registers the self-heal-monitor service", () => {
    const api = mockApi({
      pluginConfig: {
        stateFile,
        sessionsFile,
        configFile,
        configBackupsDir: path.join(dir, "backups"),
      },
    });
    register(api);
    expect(api._services).toHaveLength(1);
    expect(api._services[0].id).toBe("self-heal-monitor");
  });

  describe("agent_end handler", () => {
    it("ignores successful events", () => {
      const api = mockApi({
        pluginConfig: { stateFile, sessionsFile, configFile },
      });
      register(api);

      api._emit("agent_end", { success: true }, {});
      // State file should not be created for successful events
      expect(fs.existsSync(stateFile)).toBe(false);
    });

    it("ignores failures without rate-limit or auth errors", () => {
      const api = mockApi({
        pluginConfig: { stateFile, sessionsFile, configFile },
      });
      register(api);

      api._emit("agent_end", { success: false, error: "generic timeout" }, {});
      expect(fs.existsSync(stateFile)).toBe(false);
    });

    it("marks model as limited on rate-limit error", () => {
      const api = mockApi({
        pluginConfig: {
          stateFile,
          sessionsFile,
          configFile,
          modelOrder: ["model-a", "model-b"],
          cooldownMinutes: 10,
        },
      });
      register(api);

      api._emit(
        "agent_end",
        { success: false, error: "HTTP 429 rate limit exceeded" },
        {}
      );

      const state = loadState(stateFile);
      expect(state.limited["model-a"]).toBeDefined();
      expect(state.limited["model-a"].nextAvailableAt).toBeGreaterThan(nowSec());
    });

    it("applies extra cooldown for auth errors", () => {
      const api = mockApi({
        pluginConfig: {
          stateFile,
          sessionsFile,
          configFile,
          modelOrder: ["model-a", "model-b"],
          cooldownMinutes: 10,
        },
      });
      register(api);

      api._emit(
        "agent_end",
        { success: false, error: "HTTP 401 Unauthorized" },
        {}
      );

      const state = loadState(stateFile);
      const entry = state.limited["model-a"];
      // Auth errors add 12 * 60 minutes = 720 min extra on top of 10 min cooldown
      // Total: (10 + 720) * 60 = 43800 seconds
      const minExpected = nowSec() + (10 + 720) * 60 - 5; // 5s tolerance
      expect(entry.nextAvailableAt).toBeGreaterThanOrEqual(minExpected);
    });

    it("patches session model on rate-limit when patchPins is enabled", () => {
      fs.writeFileSync(
        sessionsFile,
        JSON.stringify({ "s1": { model: "model-a" } })
      );

      const api = mockApi({
        pluginConfig: {
          stateFile,
          sessionsFile,
          configFile,
          modelOrder: ["model-a", "model-b"],
          cooldownMinutes: 10,
        },
      });
      register(api);

      api._emit(
        "agent_end",
        { success: false, error: "rate limit hit" },
        { sessionKey: "s1" }
      );

      const sessions = JSON.parse(fs.readFileSync(sessionsFile, "utf-8"));
      expect(sessions["s1"].model).toBe("model-b");
    });
  });

  describe("message_sent handler", () => {
    it("ignores messages without rate-limit content", () => {
      const api = mockApi({
        pluginConfig: { stateFile, sessionsFile, configFile },
      });
      register(api);

      api._emit("message_sent", { content: "Hello, world!" }, {});
      expect(fs.existsSync(stateFile)).toBe(false);
    });

    it("marks first model limited when rate-limit content is detected", () => {
      const api = mockApi({
        pluginConfig: {
          stateFile,
          sessionsFile,
          configFile,
          modelOrder: ["primary", "fallback"],
          cooldownMinutes: 5,
        },
      });
      register(api);

      api._emit(
        "message_sent",
        { content: "Error: quota exceeded for this model" },
        {}
      );

      const state = loadState(stateFile);
      expect(state.limited["primary"]).toBeDefined();
      expect(state.limited["primary"].reason).toBe("outbound error observed");
    });

    it("patches session model on rate-limit content detection", () => {
      fs.writeFileSync(
        sessionsFile,
        JSON.stringify({ "s1": { model: "primary" } })
      );

      const api = mockApi({
        pluginConfig: {
          stateFile,
          sessionsFile,
          configFile,
          modelOrder: ["primary", "fallback"],
          cooldownMinutes: 5,
        },
      });
      register(api);

      api._emit(
        "message_sent",
        { content: "429 Too Many Requests" },
        { sessionKey: "s1" }
      );

      const sessions = JSON.parse(fs.readFileSync(sessionsFile, "utf-8"));
      expect(sessions["s1"].model).toBe("fallback");
    });
  });

  describe("config hot-reload", () => {
    it("picks up modelOrder changes via api.pluginConfig on monitor tick", async () => {
      const api = mockApi({
        pluginConfig: {
          stateFile,
          sessionsFile,
          configFile,
          modelOrder: ["model-a", "model-b"],
          cooldownMinutes: 10,
        },
      });
      register(api);

      // Change config before tick
      api.pluginConfig = {
        stateFile,
        sessionsFile,
        configFile,
        modelOrder: ["model-x", "model-y", "model-z"],
        cooldownMinutes: 10,
      };

      // Run the monitor service tick
      const svc = api._services[0];
      await svc.start();
      // Wait a bit for the immediate tick to run
      await new Promise((r) => setTimeout(r, 50));
      await svc.stop();

      // Verify the new model order is used by triggering an agent_end
      api._emit(
        "agent_end",
        { success: false, error: "HTTP 429 rate limit exceeded" },
        {}
      );

      const state = loadState(stateFile);
      // Should mark model-x (new first model), not model-a (old first model)
      expect(state.limited["model-x"]).toBeDefined();
      expect(state.limited["model-a"]).toBeUndefined();
    });

    it("picks up cooldownMinutes changes on monitor tick", async () => {
      const api = mockApi({
        pluginConfig: {
          stateFile,
          sessionsFile,
          configFile,
          modelOrder: ["model-a"],
          cooldownMinutes: 10,
        },
      });
      register(api);

      // Change cooldown to 60 minutes
      api.pluginConfig = {
        stateFile,
        sessionsFile,
        configFile,
        modelOrder: ["model-a"],
        cooldownMinutes: 60,
      };

      const svc = api._services[0];
      await svc.start();
      await new Promise((r) => setTimeout(r, 50));
      await svc.stop();

      // Trigger rate limit with new cooldown
      api._emit(
        "agent_end",
        { success: false, error: "rate limit hit" },
        {}
      );

      const state = loadState(stateFile);
      const entry = state.limited["model-a"];
      // With 60 min cooldown, nextAvailableAt should be ~3600 seconds in the future
      const minExpected = nowSec() + 60 * 60 - 5;
      expect(entry.nextAvailableAt).toBeGreaterThanOrEqual(minExpected);
    });

    it("logs changed config keys on reload", async () => {
      const api = mockApi({
        pluginConfig: {
          stateFile,
          sessionsFile,
          configFile,
          modelOrder: ["model-a"],
          cooldownMinutes: 10,
        },
      });
      register(api);

      api.pluginConfig = {
        stateFile,
        sessionsFile,
        configFile,
        modelOrder: ["model-a"],
        cooldownMinutes: 99,
      };

      const svc = api._services[0];
      await svc.start();
      await new Promise((r) => setTimeout(r, 50));
      await svc.stop();

      expect(api.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("config reloaded: changed cooldownMinutes")
      );
    });

    it("does not log when config has not changed", async () => {
      const api = mockApi({
        pluginConfig: {
          stateFile,
          sessionsFile,
          configFile,
          modelOrder: ["model-a"],
          cooldownMinutes: 10,
        },
      });
      register(api);

      // Don't change config
      const svc = api._services[0];
      await svc.start();
      await new Promise((r) => setTimeout(r, 50));
      await svc.stop();

      // Should not have a "config reloaded" log
      const reloadCalls = api.logger.info.mock.calls.filter(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("config reloaded")
      );
      expect(reloadCalls).toHaveLength(0);
    });

    it("ignores config reload when new config sets enabled=false", async () => {
      const api = mockApi({
        pluginConfig: {
          stateFile,
          sessionsFile,
          configFile,
          modelOrder: ["model-a"],
          cooldownMinutes: 10,
        },
      });
      register(api);

      // Try to disable via hot-reload
      api.pluginConfig = {
        enabled: false,
        stateFile,
        sessionsFile,
        configFile,
        modelOrder: ["model-a"],
        cooldownMinutes: 10,
      };

      const svc = api._services[0];
      await svc.start();
      await new Promise((r) => setTimeout(r, 50));
      await svc.stop();

      // Should have logged a warning about ignoring disabled config
      expect(api.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("plugin disabled in new config")
      );

      // Original config should still be active - trigger event with old model
      api._emit(
        "agent_end",
        { success: false, error: "rate limit hit" },
        {}
      );
      const state = loadState(stateFile);
      expect(state.limited["model-a"]).toBeDefined();
    });

    it("uses updated config in message_sent handler after reload", async () => {
      fs.writeFileSync(
        sessionsFile,
        JSON.stringify({ "s1": { model: "model-a" } })
      );

      const api = mockApi({
        pluginConfig: {
          stateFile,
          sessionsFile,
          configFile,
          modelOrder: ["model-a", "model-b"],
          cooldownMinutes: 10,
        },
      });
      register(api);

      // Update model order
      api.pluginConfig = {
        stateFile,
        sessionsFile,
        configFile,
        modelOrder: ["model-x", "model-y"],
        cooldownMinutes: 10,
      };

      const svc = api._services[0];
      await svc.start();
      await new Promise((r) => setTimeout(r, 50));
      await svc.stop();

      // message_sent should now use new model order
      api._emit(
        "message_sent",
        { content: "429 Too Many Requests" },
        {}
      );

      const state = loadState(stateFile);
      expect(state.limited["model-x"]).toBeDefined();
      expect(state.limited["model-a"]).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// parseConfig
// ---------------------------------------------------------------------------

describe("parseConfig", () => {
  it("returns defaults for empty input", () => {
    const c = parseConfig({});
    expect(c.modelOrder).toEqual([
      "anthropic/claude-opus-4-6",
      "openai-codex/gpt-5.2",
      "google-gemini-cli/gemini-2.5-flash",
    ]);
    expect(c.cooldownMinutes).toBe(300);
    expect(c.patchPins).toBe(true);
    expect(c.disableFailingCrons).toBe(false);
    expect(c.disableFailingPlugins).toBe(false);
    expect(c.whatsappRestartEnabled).toBe(true);
    expect(c.whatsappDisconnectThreshold).toBe(2);
    expect(c.whatsappMinRestartIntervalSec).toBe(300);
    expect(c.cronFailThreshold).toBe(3);
    expect(c.issueCooldownSec).toBe(6 * 3600);
    expect(c.pluginDisableCooldownSec).toBe(3600);
  });

  it("returns defaults for undefined input", () => {
    const c = parseConfig(undefined);
    expect(c.cooldownMinutes).toBe(300);
    expect(c.modelOrder).toHaveLength(3);
  });

  it("applies custom values", () => {
    const c = parseConfig({
      modelOrder: ["a", "b"],
      cooldownMinutes: 60,
      autoFix: {
        patchSessionPins: false,
        disableFailingCrons: true,
        cronFailThreshold: 5,
      },
    });
    expect(c.modelOrder).toEqual(["a", "b"]);
    expect(c.cooldownMinutes).toBe(60);
    expect(c.patchPins).toBe(false);
    expect(c.disableFailingCrons).toBe(true);
    expect(c.cronFailThreshold).toBe(5);
  });

  it("does not share modelOrder array reference with input", () => {
    const input = { modelOrder: ["a", "b"] };
    const c = parseConfig(input);
    input.modelOrder.push("c");
    expect(c.modelOrder).toEqual(["a", "b"]);
  });

  it("expands tilde paths", () => {
    const c = parseConfig({ stateFile: "~/my-state.json" });
    expect(c.stateFile).toBe(path.join(os.homedir(), "my-state.json"));
  });
});

// ---------------------------------------------------------------------------
// configDiff
// ---------------------------------------------------------------------------

describe("configDiff", () => {
  function defaultConfig(overrides: Partial<PluginConfig> = {}): PluginConfig {
    return parseConfig(overrides);
  }

  it("returns empty array for identical configs", () => {
    const a = defaultConfig();
    const b = defaultConfig();
    expect(configDiff(a, b)).toEqual([]);
  });

  it("detects scalar value changes", () => {
    const a = defaultConfig();
    const b = defaultConfig();
    b.cooldownMinutes = 999;
    expect(configDiff(a, b)).toEqual(["cooldownMinutes"]);
  });

  it("detects array value changes", () => {
    const a = defaultConfig();
    const b = defaultConfig();
    b.modelOrder = ["different-model"];
    expect(configDiff(a, b)).toContain("modelOrder");
  });

  it("detects boolean changes", () => {
    const a = defaultConfig();
    const b = defaultConfig();
    b.patchPins = !a.patchPins;
    expect(configDiff(a, b)).toContain("patchPins");
  });

  it("detects multiple changes", () => {
    const a = defaultConfig();
    const b = defaultConfig();
    b.cooldownMinutes = 1;
    b.cronFailThreshold = 99;
    b.whatsappRestartEnabled = !a.whatsappRestartEnabled;
    const diff = configDiff(a, b);
    expect(diff).toContain("cooldownMinutes");
    expect(diff).toContain("cronFailThreshold");
    expect(diff).toContain("whatsappRestartEnabled");
  });
});
