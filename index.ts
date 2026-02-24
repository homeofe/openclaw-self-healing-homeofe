import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

type State = {
  limited: Record<string, { lastHitAt: number; nextAvailableAt: number; reason?: string }>;
};

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function loadState(p: string): State {
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const d = JSON.parse(raw);
    if (!d.limited) d.limited = {};
    return d;
  } catch {
    return { limited: {} };
  }
}

function saveState(p: string, s: State) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
}

function isRateLimitLike(err?: string): boolean {
  if (!err) return false;
  const s = err.toLowerCase();
  return s.includes("rate limit") || s.includes("quota") || s.includes("429") || s.includes("resource_exhausted");
}

function isAuthScopeLike(err?: string): boolean {
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

function pickFallback(modelOrder: string[], state: State): string {
  const t = nowSec();
  for (const m of modelOrder) {
    const lim = state.limited[m];
    if (!lim) return m;
    if (lim.nextAvailableAt <= t) return m;
  }
  return modelOrder[modelOrder.length - 1];
}

function patchSessionModel(sessionsFile: string, sessionKey: string, model: string, logger: any): boolean {
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

export default function register(api: any) {
  const cfg = (api.pluginConfig ?? {}) as any;
  if (cfg.enabled === false) return;

  const modelOrder: string[] = cfg.modelOrder?.length ? cfg.modelOrder : [
    "anthropic/claude-opus-4-6",
    "openai-codex/gpt-5.2",
    "google-gemini-cli/gemini-2.5-flash",
  ];
  const cooldownMinutes: number = cfg.cooldownMinutes ?? 300;
  const stateFile = expandHome(cfg.stateFile ?? "~/.openclaw/workspace/memory/self-heal-state.json");
  const sessionsFile = expandHome(cfg.sessionsFile ?? "~/.openclaw/agents/main/sessions/sessions.json");

  const autoFix = cfg.autoFix ?? {};
  const patchPins: boolean = autoFix.patchSessionPins !== false;

  api.logger?.info?.(`[self-heal] enabled. order=${modelOrder.join(" -> ")}`);

  // Heal after an LLM failure.
  api.on("agent_end", (event: any, ctx: any) => {
    if (event?.success !== false) return;

    const err = event?.error as string | undefined;
    const rate = isRateLimitLike(err);
    const auth = isAuthScopeLike(err);
    if (!rate && !auth) return;

    const state = loadState(stateFile);
    const hitAt = nowSec();
    const extra = auth ? 12 * 60 : 0;
    const nextAvail = hitAt + (cooldownMinutes + extra) * 60;

    // Best effort: mark the pinned model as limited if we can read it.
    let pinnedModel: string | undefined;
    try {
      const data = JSON.parse(fs.readFileSync(sessionsFile, "utf-8"));
      pinnedModel = ctx?.sessionKey ? data?.[ctx.sessionKey]?.model : undefined;
    } catch {
      pinnedModel = undefined;
    }

    const key = pinnedModel || modelOrder[0];
    state.limited[key] = { lastHitAt: hitAt, nextAvailableAt: nextAvail, reason: err?.slice(0, 160) };
    saveState(stateFile, state);

    const fallback = pickFallback(modelOrder, state);

    if (patchPins && ctx?.sessionKey && fallback && fallback !== pinnedModel) {
      patchSessionModel(sessionsFile, ctx.sessionKey, fallback, api.logger);
    }
  });

  // If the system ever emits a raw rate-limit message, self-heal future turns.
  api.on("message_sent", (event: any, ctx: any) => {
    const content = String(event?.content ?? "");
    if (!content) return;
    if (!isRateLimitLike(content) && !isAuthScopeLike(content)) return;

    const state = loadState(stateFile);
    const hitAt = nowSec();
    state.limited[modelOrder[0]] = { lastHitAt: hitAt, nextAvailableAt: hitAt + cooldownMinutes * 60, reason: "outbound error observed" };
    saveState(stateFile, state);

    const fallback = pickFallback(modelOrder, state);
    if (patchPins && ctx?.sessionKey) {
      patchSessionModel(sessionsFile, ctx.sessionKey, fallback, api.logger);
    }
  });
}
