import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export type State = {
  limited: Record<string, { lastHitAt: number; nextAvailableAt: number; reason?: string }>;
  pendingBackups?: Record<string, { createdAt: number; reason: string }>; // filePath -> meta
  whatsapp?: {
    lastSeenConnectedAt?: number;
    lastRestartAt?: number;
    disconnectStreak?: number;
  };
  cron?: {
    failCounts?: Record<string, number>; // job id -> consecutive failures
    lastIssueCreatedAt?: Record<string, number>; // job id -> timestamp
  };
  plugins?: {
    lastDisableAt?: Record<string, number>; // plugin id -> timestamp
  };
};

export type PluginConfig = {
  modelOrder: string[];
  cooldownMinutes: number;
  stateFile: string;
  sessionsFile: string;
  configFile: string;
  configBackupsDir: string;
  patchPins: boolean;
  disableFailingCrons: boolean;
  disableFailingPlugins: boolean;
  whatsappRestartEnabled: boolean;
  whatsappDisconnectThreshold: number;
  whatsappMinRestartIntervalSec: number;
  cronFailThreshold: number;
  issueCooldownSec: number;
  pluginDisableCooldownSec: number;
};

const DEFAULT_MODEL_ORDER = [
  "anthropic/claude-opus-4-6",
  "openai-codex/gpt-5.2",
  "google-gemini-cli/gemini-2.5-flash",
];

export function parseConfig(raw: any): PluginConfig {
  const cfg = raw ?? {};
  const autoFix = cfg.autoFix ?? {};
  return {
    modelOrder: cfg.modelOrder?.length ? [...cfg.modelOrder] : [...DEFAULT_MODEL_ORDER],
    cooldownMinutes: cfg.cooldownMinutes ?? 300,
    stateFile: expandHome(cfg.stateFile ?? "~/.openclaw/workspace/memory/self-heal-state.json"),
    sessionsFile: expandHome(cfg.sessionsFile ?? "~/.openclaw/agents/main/sessions/sessions.json"),
    configFile: expandHome(cfg.configFile ?? "~/.openclaw/openclaw.json"),
    configBackupsDir: expandHome(cfg.configBackupsDir ?? "~/.openclaw/backups/openclaw.json"),
    patchPins: autoFix.patchSessionPins !== false,
    disableFailingCrons: autoFix.disableFailingCrons === true,
    disableFailingPlugins: autoFix.disableFailingPlugins === true,
    whatsappRestartEnabled: autoFix.restartWhatsappOnDisconnect !== false,
    whatsappDisconnectThreshold: autoFix.whatsappDisconnectThreshold ?? 2,
    whatsappMinRestartIntervalSec: autoFix.whatsappMinRestartIntervalSec ?? 300,
    cronFailThreshold: autoFix.cronFailThreshold ?? 3,
    issueCooldownSec: autoFix.issueCooldownSec ?? 6 * 3600,
    pluginDisableCooldownSec: autoFix.pluginDisableCooldownSec ?? 3600,
  };
}

export function configDiff(a: PluginConfig, b: PluginConfig): string[] {
  const changes: string[] = [];
  for (const k of Object.keys(a) as (keyof PluginConfig)[]) {
    const va = a[k];
    const vb = b[k];
    if (Array.isArray(va) && Array.isArray(vb)) {
      if (JSON.stringify(va) !== JSON.stringify(vb)) changes.push(k);
    } else if (va !== vb) {
      changes.push(k);
    }
  }
  return changes;
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function loadState(p: string): State {
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const d = JSON.parse(raw);
    if (!d.limited) d.limited = {};
    if (!d.pendingBackups) d.pendingBackups = {};
    if (!d.whatsapp) d.whatsapp = {};
    if (!d.cron) d.cron = {};
    if (!d.cron.failCounts) d.cron.failCounts = {};
    if (!d.cron.lastIssueCreatedAt) d.cron.lastIssueCreatedAt = {};
    if (!d.plugins) d.plugins = {};
    if (!d.plugins.lastDisableAt) d.plugins.lastDisableAt = {};
    return d;
  } catch {
    return { limited: {}, pendingBackups: {}, whatsapp: {}, cron: { failCounts: {}, lastIssueCreatedAt: {} }, plugins: { lastDisableAt: {} } };
  }
}

export function saveState(p: string, s: State) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
}

export function isRateLimitLike(err?: string): boolean {
  if (!err) return false;
  const s = err.toLowerCase();
  return s.includes("rate limit") || s.includes("quota") || s.includes("429") || s.includes("resource_exhausted");
}

export function isAuthScopeLike(err?: string): boolean {
  if (!err) return false;
  const s = err.toLowerCase();
  return (
    s.includes("http 401") ||
    s.includes("insufficient permissions") ||
    s.includes("missing scopes") ||
    s.includes("api.responses.write") ||
    s.includes("unauthorized")
  );
}

export function pickFallback(modelOrder: string[], state: State): string {
  const t = nowSec();
  for (const m of modelOrder) {
    const lim = state.limited[m];
    if (!lim) return m;
    if (lim.nextAvailableAt <= t) return m;
  }
  return modelOrder[modelOrder.length - 1];
}

export function patchSessionModel(sessionsFile: string, sessionKey: string, model: string, logger: any): boolean {
  try {
    const raw = fs.readFileSync(sessionsFile, "utf-8");
    const data = JSON.parse(raw);
    if (!data[sessionKey]) return false;
    const prev = data[sessionKey].model;
    data[sessionKey].model = model;
    fs.writeFileSync(sessionsFile, JSON.stringify(data, null, 0));
    logger?.warn?.(`[self-heal] patched session model: ${sessionKey} ${prev} -> ${model}`);
    return true;
  } catch (e: any) {
    logger?.error?.(`[self-heal] failed to patch session model: ${e?.message ?? String(e)}`);
    return false;
  }
}

async function runCmd(api: any, cmd: string, timeoutMs = 15000): Promise<{ ok: boolean; stdout: string; stderr: string; code?: number }> {
  try {
    const res = await api.runtime.system.runCommandWithTimeout({
      command: ["bash", "-lc", cmd],
      timeoutMs,
    });
    return {
      ok: res.exitCode === 0,
      stdout: String(res.stdout ?? ""),
      stderr: String(res.stderr ?? ""),
      code: res.exitCode,
    };
  } catch (e: any) {
    return { ok: false, stdout: "", stderr: e?.message ?? String(e) };
  }
}

export function safeJsonParse<T>(s: string): T | undefined {
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
}

export default function register(api: any) {
  const raw = (api.pluginConfig ?? {}) as any;
  if (raw.enabled === false) return;

  let config = parseConfig(raw);

  api.logger?.info?.(`[self-heal] enabled. order=${config.modelOrder.join(" -> ")}`);

  // If the gateway booted and config is valid, remove any pending backups from previous runs.
  cleanupPendingBackups("startup").catch(() => undefined);

  function isConfigValid(): { ok: boolean; error?: string } {
    try {
      const raw = fs.readFileSync(config.configFile, "utf-8");
      JSON.parse(raw);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  }

  function backupConfig(reason: string): string | undefined {
    try {
      fs.mkdirSync(config.configBackupsDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const out = path.join(config.configBackupsDir, `openclaw.json.${ts}.bak`);
      fs.copyFileSync(config.configFile, out);

      // Mark as pending so we can delete it after we have evidence the gateway still boots.
      const st = loadState(config.stateFile);
      st.pendingBackups = st.pendingBackups || {};
      st.pendingBackups[out] = { createdAt: nowSec(), reason };
      saveState(config.stateFile, st);

      api.logger?.info?.(`[self-heal] backed up openclaw.json (${reason}) -> ${out} (pending cleanup)`);
      return out;
    } catch (e: any) {
      api.logger?.warn?.(`[self-heal] failed to backup openclaw.json: ${e?.message ?? String(e)}`);
      return undefined;
    }
  }

  async function cleanupPendingBackups(where: string) {
    const v = isConfigValid();
    if (!v.ok) {
      api.logger?.warn?.(`[self-heal] not cleaning backups (${where}): openclaw.json invalid: ${v.error}`);
      return;
    }

    // Best-effort: ensure gateway responds to a status call.
    const gw = await runCmd(api, "openclaw gateway status", 15000);
    if (!gw.ok) {
      api.logger?.warn?.(`[self-heal] not cleaning backups (${where}): gateway status check failed`);
      return;
    }

    const st = loadState(config.stateFile);
    const pending = st.pendingBackups || {};
    const paths = Object.keys(pending);
    if (paths.length === 0) return;

    let deleted = 0;
    for (const p of paths) {
      try {
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
          deleted++;
        }
      } catch {
        // keep it in pending if we couldn't delete
        continue;
      }
      delete pending[p];
    }

    st.pendingBackups = pending;
    saveState(config.stateFile, st);
    api.logger?.info?.(`[self-heal] cleaned ${deleted} pending openclaw.json backups (${where})`);
  }

  function reloadConfig(): boolean {
    try {
      const newRaw = (api.pluginConfig ?? {}) as any;
      if (newRaw.enabled === false) {
        api.logger?.warn?.("[self-heal] config reload: plugin disabled in new config, ignoring");
        return false;
      }
      const newConfig = parseConfig(newRaw);
      const changes = configDiff(config, newConfig);
      if (changes.length === 0) return false;

      api.logger?.info?.(`[self-heal] config reloaded: changed ${changes.join(", ")}`);
      config = newConfig;
      return true;
    } catch (e: any) {
      api.logger?.warn?.(`[self-heal] config reload failed, keeping current: ${e?.message ?? String(e)}`);
      return false;
    }
  }

  // Heal after an LLM failure.
  api.on("agent_end", (event: any, ctx: any) => {
    if (event?.success !== false) return;

    const err = event?.error as string | undefined;
    const rate = isRateLimitLike(err);
    const auth = isAuthScopeLike(err);
    if (!rate && !auth) return;

    const state = loadState(config.stateFile);
    const hitAt = nowSec();
    const extra = auth ? 12 * 60 : 0;
    const nextAvail = hitAt + (config.cooldownMinutes + extra) * 60;

    // Best effort: mark the pinned model as limited if we can read it.
    let pinnedModel: string | undefined;
    try {
      const data = JSON.parse(fs.readFileSync(config.sessionsFile, "utf-8"));
      pinnedModel = ctx?.sessionKey ? data?.[ctx.sessionKey]?.model : undefined;
    } catch {
      pinnedModel = undefined;
    }

    const key = pinnedModel || config.modelOrder[0];
    state.limited[key] = { lastHitAt: hitAt, nextAvailableAt: nextAvail, reason: err?.slice(0, 160) };
    saveState(config.stateFile, state);

    const fallback = pickFallback(config.modelOrder, state);

    if (config.patchPins && ctx?.sessionKey && fallback && fallback !== pinnedModel) {
      patchSessionModel(config.sessionsFile, ctx.sessionKey, fallback, api.logger);
    }
  });

  // If the system ever emits a raw rate-limit message, self-heal future turns.
  api.on("message_sent", (event: any, ctx: any) => {
    const content = String(event?.content ?? "");
    if (!content) return;
    if (!isRateLimitLike(content) && !isAuthScopeLike(content)) return;

    const state = loadState(config.stateFile);
    const hitAt = nowSec();
    state.limited[config.modelOrder[0]] = {
      lastHitAt: hitAt,
      nextAvailableAt: hitAt + config.cooldownMinutes * 60,
      reason: "outbound error observed",
    };
    saveState(config.stateFile, state);

    const fallback = pickFallback(config.modelOrder, state);
    if (config.patchPins && ctx?.sessionKey) {
      patchSessionModel(config.sessionsFile, ctx.sessionKey, fallback, api.logger);
    }
  });

  // Background monitor: WhatsApp disconnects, failing crons, failing plugins.
  api.registerService({
    id: "self-heal-monitor",
    start: async () => {
      let timer: NodeJS.Timeout | undefined;

      const tick = async () => {
        // Hot-reload: re-read api.pluginConfig to pick up changes
        reloadConfig();

        const state = loadState(config.stateFile);

        // --- WhatsApp disconnect self-heal ---
        if (config.whatsappRestartEnabled) {
          const st = await runCmd(api, "openclaw channels status --json", 15000);
          if (st.ok) {
            const parsed = safeJsonParse<any>(st.stdout);
            const wa = parsed?.channels?.whatsapp;
            const connected = wa?.status === "connected" || wa?.connected === true;

            if (connected) {
              state.whatsapp!.lastSeenConnectedAt = nowSec();
              state.whatsapp!.disconnectStreak = 0;
            } else {
              state.whatsapp!.disconnectStreak = (state.whatsapp!.disconnectStreak ?? 0) + 1;

              const lastRestartAt = state.whatsapp!.lastRestartAt ?? 0;
              const since = nowSec() - lastRestartAt;
              const shouldRestart =
                state.whatsapp!.disconnectStreak >= config.whatsappDisconnectThreshold &&
                since >= config.whatsappMinRestartIntervalSec;

              if (shouldRestart) {
                api.logger?.warn?.(
                  `[self-heal] WhatsApp appears disconnected (streak=${state.whatsapp!.disconnectStreak}). Restarting gateway.`
                );
                // Guardrail: never restart if openclaw.json is invalid
                const v = isConfigValid();
                if (!v.ok) {
                  api.logger?.error?.(`[self-heal] NOT restarting gateway: openclaw.json invalid: ${v.error}`);
                } else {
                  backupConfig("pre-gateway-restart");
                  await runCmd(api, "openclaw gateway restart", 60000);
                  // If we are still alive after restart, attempt cleanup.
                  await cleanupPendingBackups("post-gateway-restart");
                  state.whatsapp!.lastRestartAt = nowSec();
                  state.whatsapp!.disconnectStreak = 0;
                }
              }
            }
          }
        }

        // --- Cron failure self-heal ---
        if (config.disableFailingCrons) {
          const res = await runCmd(api, "openclaw cron list --json", 15000);
          if (res.ok) {
            const parsed = safeJsonParse<any>(res.stdout);
            const jobs: any[] = parsed?.jobs ?? [];
            for (const job of jobs) {
              const id = job.id;
              const name = job.name;
              const lastStatus = job?.state?.lastStatus;
              const lastError = String(job?.state?.lastError ?? "");

              const isFail = lastStatus === "error";
              const prev = state.cron!.failCounts![id] ?? 0;
              state.cron!.failCounts![id] = isFail ? prev + 1 : 0;

              if (isFail && state.cron!.failCounts![id] >= config.cronFailThreshold) {
                // Guardrail: do not touch crons if config is invalid
                const v = isConfigValid();
                if (!v.ok) {
                  api.logger?.error?.(`[self-heal] NOT disabling cron: openclaw.json invalid: ${v.error}`);
                } else {
                  // Disable the cron
                  api.logger?.warn?.(`[self-heal] Disabling failing cron ${name} (${id}).`);
                  backupConfig("pre-cron-disable");
                  await runCmd(api, `openclaw cron edit ${id} --disable`, 15000);
                  await cleanupPendingBackups("post-cron-disable");
                }

                // Create issue, but rate limit issue creation
                const lastIssueAt = state.cron!.lastIssueCreatedAt![id] ?? 0;
                if (nowSec() - lastIssueAt >= config.issueCooldownSec) {
                  const body = [
                    `Cron job failed repeatedly and was disabled by openclaw-self-healing.`,
                    ``,
                    `Name: ${name}`,
                    `ID: ${id}`,
                    `Consecutive failures: ${state.cron!.failCounts![id]}`,
                    `Last error:`,
                    "```",
                    lastError.slice(0, 1200),
                    "```",
                  ].join("\n");

                  // Issue goes to this repo by default
                  await runCmd(
                    api,
                    `gh issue create -R elvatis/openclaw-self-healing-elvatis --title "Cron disabled: ${name}" --body ${JSON.stringify(body)} --label security`,
                    20000
                  );
                  state.cron!.lastIssueCreatedAt![id] = nowSec();
                }

                state.cron!.failCounts![id] = 0;
              }
            }
          }
        }

        // --- Plugin error rollback (disable plugin) ---
        if (config.disableFailingPlugins) {
          const res = await runCmd(api, "openclaw plugins list", 15000);
          if (res.ok) {
            // Heuristic: look for lines containing 'error' or 'crash'
            const lines = res.stdout.split("\n");
            for (const ln of lines) {
              if (!ln.toLowerCase().includes("error")) continue;
              // No robust parsing available in plain output. Use a conservative approach:
              // if we see our own plugin listed with error, do not disable others.
            }
          }
          // TODO: when openclaw provides plugins list --json, parse and disable any status=error.
        }

        saveState(config.stateFile, state);
      };

      // tick every 60s
      timer = setInterval(() => {
        tick().catch((e) => api.logger?.error?.(`[self-heal] monitor tick failed: ${e?.message ?? String(e)}`));
      }, 60_000);

      // run once immediately
      tick().catch((e) => api.logger?.error?.(`[self-heal] monitor start tick failed: ${e?.message ?? String(e)}`));

      // store timer for stop
      (api as any).__selfHealTimer = timer;
    },
    stop: async () => {
      const t: NodeJS.Timeout | undefined = (api as any).__selfHealTimer;
      if (t) clearInterval(t);
    },
  });
}
