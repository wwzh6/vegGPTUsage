import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// src/sync.ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";

// src/contract.ts
var INTERVAL = 6e5;
var MIN_INTERVAL = 15e3;
var API_URL = "https://cotemu.com/api/open/accounts";
var emptyState = () => ({
  data: null,
  lastAttemptAtMs: null,
  lastCompletedAtMs: null,
  nextAllowedAtMs: 0,
  nextRefreshAtMs: 0,
  autoPaused: false,
  error: null
});
function timestamp(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 864e13 ? value : null;
}
function normalize(body, now) {
  if (!body || typeof body !== "object" || !Array.isArray(body.accounts))
    throw new Error("invalid_response");
  const root = body;
  const bound = root.accounts.filter((a) => a && a.bound === true);
  if (bound.length !== 1) throw new Error(bound.length ? "multiple_bound" : "unbound");
  const account = bound[0];
  if (account.platform !== "openai") throw new Error("wrong_platform");
  const window = account.seven_day;
  const value = window?.used_percent;
  const serverMs = timestamp(root.server_ms);
  const updated = timestamp(account.updated_at_ms);
  return {
    usedPercent: typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null,
    resetsAtMs: timestamp(window?.resets_at_ms),
    enforced: typeof window?.enforced === "boolean" ? window.enforced : null,
    accountStatus: ["available", "tripped", "offline", "paused", "unavailable"].includes(account.status) ? account.status : "unknown",
    updatedAtMs: updated !== null && serverMs !== null && updated <= serverMs ? updated : null,
    serverMs,
    sampledAtMs: now
  };
}
function result(state, now, queried = false, mode) {
  const { data, ...query } = state;
  const elapsed = data ? now - data.sampledAtMs : 0;
  return {
    version: 1,
    data,
    serverNowMs: data?.serverMs != null && elapsed >= 0 ? data.serverMs + elapsed : null,
    query: {
      ...query,
      state: mode ?? (state.error ? "error" : "ok"),
      queried,
      stale: data !== null && state.error !== null,
      returnedAtMs: now
    }
  };
}
var messages = {
  missing_key: "\u5C1A\u672A\u914D\u7F6E COTEMU_API_KEY",
  invalid_key: "\u5BC6\u94A5\u65E0\u6548\uFF0C\u8BF7\u6838\u5BF9\u914D\u7F6E",
  key_disabled: "\u5BC6\u94A5\u5DF2\u505C\u7528",
  owner_disabled: "\u5BC6\u94A5\u6240\u5C5E\u7528\u6237\u5DF2\u505C\u7528",
  team_forbidden: "\u8D26\u53F7\u8BBF\u95EE\u6743\u9650\u4E0D\u8DB3",
  bad_team: "\u67E5\u8BE2\u53C2\u6570\u5F02\u5E38",
  rate_limited: "\u8BF7\u6C42\u53D7\u9650\uFF0C\u7B49\u5F85\u51B7\u5374\u7ED3\u675F",
  unauthorized: "\u8EAB\u4EFD\u9A8C\u8BC1\u5931\u8D25",
  forbidden: "\u8FDE\u63A5\u6743\u9650\u4E0D\u8DB3",
  unbound: "\u672A\u627E\u5230\u5BC6\u94A5\u7ED1\u5B9A\u7684\u8D26\u53F7",
  wrong_platform: "\u7ED1\u5B9A\u8D26\u53F7\u4E0D\u662F OpenAI \u8D26\u53F7",
  multiple_bound: "\u8FD4\u56DE\u4E86\u591A\u4E2A\u7ED1\u5B9A\u8D26\u53F7",
  invalid_response: "\u63A5\u53E3\u6570\u636E\u683C\u5F0F\u5F02\u5E38",
  network_error: "\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25",
  timeout: "\u67E5\u8BE2\u8D85\u65F6",
  http_error: "\u63A5\u53E3\u6682\u65F6\u4E0D\u53EF\u7528",
  cache_error: "\u672C\u5730\u67E5\u8BE2\u72B6\u6001\u65E0\u6CD5\u4FDD\u5B58",
  busy: "\u5176\u4ED6\u4F1A\u8BDD\u6B63\u5728\u67E5\u8BE2\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5",
  shared_auth_required: "\u8BF7\u4F7F\u7528\u6709\u4ED3\u5E93\u8BFB\u53D6\u6743\u9650\u7684 GitHub \u8D26\u53F7\u767B\u5F55",
  shared_not_ready: "\u5171\u4EAB\u6570\u636E\u5C1A\u672A\u53D1\u5E03\uFF0C\u6216\u5F53\u524D GitHub \u8D26\u53F7\u6CA1\u6709\u4ED3\u5E93\u8BFB\u53D6\u6743\u9650",
  shared_unavailable: "\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u5171\u4EAB\u6570\u636E",
  shared_stale: "GitHub \u540C\u6B65\u5EF6\u8FDF\uFF0C\u5F53\u524D\u4E3A\u65E7\u6570\u636E",
  shared_time_unknown: "\u65E0\u6CD5\u786E\u5B9A\u5171\u4EAB\u6570\u636E\u7684\u65F6\u95F4\u57FA\u51C6",
  shared_sync_limited: "\u7EDF\u4E00\u67E5\u8BE2\u6B63\u5728\u51B7\u5374\uFF0C\u7B49\u5F85\u4E0B\u4E00\u6B21 GitHub \u540C\u6B65"
};

// src/store.ts
import { mkdir, readFile, writeFile, rename, unlink, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
var SharedStore = class {
  directory;
  constructor(root, key) {
    this.directory = join(root, createHash("sha256").update(key).digest("hex"));
  }
  async read() {
    try {
      const value = JSON.parse(await readFile(join(this.directory, "state.json"), "utf8"));
      if (value.version !== 1 || typeof value.state?.autoPaused !== "boolean" || !Number.isFinite(value.state.nextAllowedAtMs) || !Number.isFinite(value.state.nextRefreshAtMs))
        throw new Error("cache_error");
      return value.state;
    } catch (error) {
      if (error.code === "ENOENT") return emptyState();
      throw new Error("cache_error");
    }
  }
  async write(state) {
    const target = join(this.directory, "state.json");
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, state }), { mode: 384 });
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => {
      });
    }
  }
  async recover() {
    const recovery = join(this.directory, "recovery");
    try {
      await mkdir(recovery);
    } catch {
      return;
    }
    const lock = join(this.directory, "lock");
    try {
      let dead = false;
      try {
        const owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"));
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return;
        try {
          process.kill(owner.pid, 0);
        } catch (error) {
          dead = error.code === "ESRCH";
        }
      } catch {
        const info = await stat(lock).catch(() => null);
        dead = info !== null && Date.now() - info.mtimeMs > 3e4;
      }
      if (dead) {
        await unlink(join(lock, "owner.json")).catch(() => {
        });
        await rmdir(lock).catch(() => {
        });
      }
    } finally {
      await rmdir(recovery).catch(() => {
      });
    }
  }
  async locked(operation) {
    await mkdir(this.directory, { recursive: true, mode: 448 });
    const lock = join(this.directory, "lock");
    const deadline = performance.now() + 2e4;
    for (; ; ) {
      try {
        await mkdir(lock);
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw new Error("cache_error");
        await this.recover();
        if (performance.now() >= deadline) throw new Error("busy");
        await sleep(50);
      }
    }
    try {
      await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid }));
      return await operation();
    } finally {
      await unlink(join(lock, "owner.json")).catch(() => {
      });
      await rmdir(lock).catch(() => {
      });
    }
  }
};

// src/service.ts
var knownCodes = /* @__PURE__ */ new Set(["missing_key", "invalid_key", "key_disabled", "owner_disabled", "team_forbidden", "bad_team", "rate_limited"]);
function retryDelay(header, now) {
  if (!header?.trim()) return INTERVAL;
  const value = header.trim();
  if (/^\d+(\.\d+)?$/.test(value)) {
    const ms = Number(value) * 1e3;
    return Number.isFinite(ms) ? Math.max(MIN_INTERVAL, ms) : INTERVAL;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(MIN_INTERVAL, date - now) : INTERVAL;
}
var UsageService = class {
  constructor(key, root, fetcher = fetch, now = Date.now) {
    this.key = key;
    this.fetcher = fetcher;
    this.now = now;
    this.store = new SharedStore(root, key ?? "missing");
  }
  key;
  fetcher;
  now;
  pending;
  store;
  get(refresh = false) {
    if (!this.key?.trim()) return Promise.resolve(result({ ...emptyState(), error: "missing_key", autoPaused: true }, this.now()));
    if (!this.pending) this.pending = this.query(refresh).finally(() => {
      this.pending = void 0;
    });
    return this.pending;
  }
  async query(refresh) {
    let current = emptyState();
    const requestedAt = this.now();
    try {
      return await this.store.locked(async () => {
        current = await this.store.read();
        const start = this.now();
        if (current.lastCompletedAtMs !== null && current.lastCompletedAtMs >= requestedAt && current.lastAttemptAtMs !== null && current.lastAttemptAtMs <= requestedAt)
          return result(current, start, false, current.error === "rate_limited" ? "cooldown" : "recent");
        if (start < current.nextAllowedAtMs)
          return result(current, start, false, current.error === "rate_limited" ? "cooldown" : "recent");
        if (!refresh && (current.autoPaused || start < current.nextRefreshAtMs)) return result(current, start);
        current.lastAttemptAtMs = start;
        current.nextAllowedAtMs = start + MIN_INTERVAL;
        current.nextRefreshAtMs = start + INTERVAL;
        await this.store.write(current);
        const signal = AbortSignal.timeout(15e3);
        try {
          const response = await this.fetcher(API_URL, {
            headers: { Authorization: `Bearer ${this.key}`, Accept: "application/json" },
            redirect: "error",
            signal
          });
          let body = null;
          try {
            body = await response.json();
          } catch {
            if (response.ok) throw new Error("invalid_response");
          }
          if (!response.ok) {
            const raw = body && typeof body === "object" ? body.code : null;
            current.error = knownCodes.has(raw) ? raw : response.status === 401 ? "unauthorized" : response.status === 403 ? "forbidden" : response.status === 429 ? "rate_limited" : "http_error";
            current.autoPaused = response.status === 401 || response.status === 403;
            if (response.status === 429) {
              current.error = "rate_limited";
              current.nextAllowedAtMs = this.now() + retryDelay(response.headers.get("Retry-After"), this.now());
            }
          } else {
            current.data = normalize(body, this.now());
            current.error = null;
            current.autoPaused = false;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          const semantic = ["unbound", "wrong_platform", "multiple_bound"];
          current.error = signal.aborted ? "timeout" : [...semantic, "invalid_response"].includes(message) ? message : "network_error";
          if (semantic.includes(message)) current.data = null;
        }
        current.lastCompletedAtMs = this.now();
        current.nextRefreshAtMs = current.error === "rate_limited" ? current.nextAllowedAtMs : this.now() + INTERVAL;
        await this.store.write(current);
        return result(current, this.now(), true);
      });
    } catch (error) {
      if (!current.data) current = await this.store.read().catch(() => current);
      current.error = error instanceof Error && error.message === "busy" ? "busy" : "cache_error";
      current.nextRefreshAtMs = this.now() + INTERVAL;
      return result(current, this.now());
    }
  }
};

// src/publication.ts
function decodePublication(value) {
  const item = value;
  const publishedAtMs = timestamp(item?.publishedAtMs);
  const raw = item?.state;
  if (item?.version !== 1 || publishedAtMs === null || !raw || typeof raw.autoPaused !== "boolean" || !Number.isSafeInteger(raw.nextAllowedAtMs) || raw.nextAllowedAtMs < 0 || !Number.isSafeInteger(raw.nextRefreshAtMs) || raw.nextRefreshAtMs < 0 || raw.error !== null && !Object.hasOwn(messages, raw.error)) throw new Error("invalid_response");
  const state = {
    ...emptyState(),
    lastAttemptAtMs: timestamp(raw.lastAttemptAtMs),
    lastCompletedAtMs: timestamp(raw.lastCompletedAtMs),
    nextAllowedAtMs: raw.nextAllowedAtMs,
    nextRefreshAtMs: raw.nextRefreshAtMs,
    autoPaused: raw.autoPaused,
    error: raw.error
  };
  if (raw.data !== null) {
    const data = raw.data;
    const sampledAtMs = timestamp(data?.sampledAtMs);
    if (!data || sampledAtMs === null) throw new Error("invalid_response");
    state.data = normalize({ server_ms: data.serverMs, accounts: [{
      bound: true,
      platform: "openai",
      status: data.accountStatus,
      updated_at_ms: data.updatedAtMs,
      seven_day: { used_percent: data.usedPercent, resets_at_ms: data.resetsAtMs, enforced: data.enforced }
    }] }, sampledAtMs);
  }
  return { version: 1, publishedAtMs, state };
}
function publication(state, now) {
  return decodePublication({ version: 1, publishedAtMs: now, state });
}

// src/settings.ts
var REPOSITORY = "wwzh6/vegGPTUsage";
var DATA_BRANCH = "quota-data";
var DATA_PATH = "usage.json";
var SNAPSHOT_URL = `https://api.github.com/repos/${REPOSITORY}/contents/${DATA_PATH}?ref=${DATA_BRANCH}`;

// src/sync.ts
async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token || process.env.GITHUB_REPOSITORY !== REPOSITORY) throw new Error("configuration");
  const api = async (path, method = "GET", body, allowMissing = false) => {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "VegetationQuota-sync"
      },
      ...body ? { body: JSON.stringify(body) } : {},
      redirect: "error",
      signal: AbortSignal.timeout(15e3)
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error("github");
    return response.json();
  };
  const ref = await api(`/git/ref/heads/${DATA_BRANCH}`, "GET", void 0, true);
  const existing = ref ? await api(`/contents/${DATA_PATH}?ref=${DATA_BRANCH}`) : null;
  const previous = existing ? decodePublication(JSON.parse(Buffer.from(existing.content, "base64").toString("utf8"))) : null;
  const root = await mkdtemp(join2(tmpdir(), "vegetation-sync-"));
  try {
    const service = new UsageService(process.env.COTEMU_API_KEY, root);
    if (previous) await service.store.locked(() => service.store.write(previous.state));
    const usage = await service.get(process.env.VEGETATION_MANUAL_REFRESH === "true");
    const { state: _mode, queried: _queried, stale: _stale, returnedAtMs: _returned, ...query } = usage.query;
    const state = { ...query, data: usage.data };
    const content = JSON.stringify(publication(state, Date.now())) + "\n";
    const blob = await api("/git/blobs", "POST", { content, encoding: "utf-8" });
    const parent = ref ? await api(`/git/commits/${ref.object.sha}`) : null;
    const tree = await api("/git/trees", "POST", {
      ...parent ? { base_tree: parent.tree.sha } : {},
      tree: [{ path: DATA_PATH, mode: "100644", type: "blob", sha: blob.sha }]
    });
    const commit = await api("/git/commits", "POST", {
      message: "Update shared usage snapshot",
      tree: tree.sha,
      parents: ref ? [ref.object.sha] : []
    });
    if (ref) await api(`/git/refs/heads/${DATA_BRANCH}`, "PATCH", { sha: commit.sha, force: false });
    else await api("/git/refs", "POST", { ref: `refs/heads/${DATA_BRANCH}`, sha: commit.sha });
    console.log(JSON.stringify({ published: true, queried: usage.query.queried, state: state.error ?? "ok" }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
main().catch(() => {
  console.error("Shared usage synchronization failed; no raw API response was logged.");
  process.exitCode = 1;
});
