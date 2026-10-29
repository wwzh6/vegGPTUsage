import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// src/snapshot-server.ts
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// src/contract.ts
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
  shared_stale: "\u5171\u4EAB\u5FEB\u7167\u7B49\u5F85\u540C\u6B65",
  shared_time_unknown: "\u65E0\u6CD5\u786E\u5B9A\u5171\u4EAB\u6570\u636E\u7684\u65F6\u95F4\u57FA\u51C6",
  shared_sync_limited: "\u7EDF\u4E00\u67E5\u8BE2\u6B63\u5728\u51B7\u5374\uFF0C\u7B49\u5F85\u4E0B\u4E00\u6B21 GitHub \u540C\u6B65"
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
  const lease = item.publisherLease;
  if (lease !== void 0 && (!lease || typeof lease.owner !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(lease.owner) || timestamp(lease.expiresAtMs) === null)) throw new Error("invalid_response");
  return {
    version: 1,
    publishedAtMs,
    state,
    ...lease ? { publisherLease: { owner: lease.owner, expiresAtMs: lease.expiresAtMs } } : {}
  };
}

// src/snapshot-server.ts
function snapshotServer(directory2) {
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.url !== "/vegetation-quota/usage.json") {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    try {
      const bytes = await readFile(join(directory2, "usage.json"));
      if (bytes.length > 32768) throw new Error("invalid_response");
      const { publisherLease: _lease, ...value } = decodePublication(JSON.parse(bytes.toString("utf8")));
      const body = JSON.stringify(value) + "\n";
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
      response.end(request.method === "HEAD" ? void 0 : body);
    } catch {
      response.writeHead(503).end();
    }
  });
}

// src/serve-snapshot.ts
var host = process.env.VEGETATION_HTTP_HOST ?? "127.0.0.1";
var port = Number(process.env.VEGETATION_HTTP_PORT ?? 9817);
var directory = process.env.VEGETATION_PUBLIC_DIRECTORY ?? "/var/cache/vegetation-quota-public";
var server = snapshotServer(directory);
server.on("error", () => {
  console.error("Snapshot listener unavailable.");
  process.exitCode = 1;
});
server.listen(port, host);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
