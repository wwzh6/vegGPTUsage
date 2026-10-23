export const INTERVAL = 600_000;
export const MIN_INTERVAL = 15_000;
export const API_URL = 'https://cotemu.com/api/open/accounts';

export interface Snapshot {
  usedPercent: number | null;
  resetsAtMs: number | null;
  enforced: boolean | null;
  accountStatus: 'available' | 'tripped' | 'offline' | 'paused' | 'unavailable' | 'unknown';
  updatedAtMs: number | null;
  serverMs: number | null;
  sampledAtMs: number;
}

export type ErrorCode = 'missing_key' | 'invalid_key' | 'key_disabled' | 'owner_disabled'
  | 'team_forbidden' | 'bad_team' | 'rate_limited' | 'unauthorized' | 'forbidden'
  | 'unbound' | 'wrong_platform' | 'multiple_bound' | 'invalid_response'
  | 'network_error' | 'timeout' | 'http_error' | 'cache_error' | 'busy';

export interface State {
  data: Snapshot | null;
  lastAttemptAtMs: number | null;
  lastCompletedAtMs: number | null;
  nextAllowedAtMs: number;
  nextRefreshAtMs: number;
  autoPaused: boolean;
  error: ErrorCode | null;
}

export interface UsageResult {
  version: 1;
  data: Snapshot | null;
  serverNowMs: number | null;
  query: Omit<State, 'data'> & {
    state: 'ok' | 'error' | 'recent' | 'cooldown';
    queried: boolean;
    stale: boolean;
    returnedAtMs: number;
  };
}

export const emptyState = (): State => ({
  data: null, lastAttemptAtMs: null, lastCompletedAtMs: null,
  nextAllowedAtMs: 0, nextRefreshAtMs: 0, autoPaused: false, error: null,
});

export function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    && value <= 8_640_000_000_000_000 ? value : null;
}

export function normalize(body: unknown, now: number): Snapshot {
  if (!body || typeof body !== 'object' || !Array.isArray((body as any).accounts))
    throw new Error('invalid_response');
  const root = body as Record<string, any>;
  const bound = root.accounts.filter((a: any) => a && a.bound === true);
  if (bound.length !== 1) throw new Error(bound.length ? 'multiple_bound' : 'unbound');
  const account = bound[0];
  if (account.platform !== 'openai') throw new Error('wrong_platform');
  const window = account.seven_day;
  const value = window?.used_percent;
  const serverMs = timestamp(root.server_ms);
  const updated = timestamp(account.updated_at_ms);
  return {
    usedPercent: typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null,
    resetsAtMs: timestamp(window?.resets_at_ms),
    enforced: typeof window?.enforced === 'boolean' ? window.enforced : null,
    accountStatus: ['available', 'tripped', 'offline', 'paused', 'unavailable'].includes(account.status) ? account.status : 'unknown',
    updatedAtMs: updated !== null && serverMs !== null && updated <= serverMs ? updated : null,
    serverMs, sampledAtMs: now,
  };
}

export function result(state: State, now: number, queried = false, mode?: UsageResult['query']['state']): UsageResult {
  const { data, ...query } = state;
  const elapsed = data ? now - data.sampledAtMs : 0;
  return {
    version: 1, data,
    serverNowMs: data?.serverMs != null && elapsed >= 0 ? data.serverMs + elapsed : null,
    query: { ...query, state: mode ?? (state.error ? 'error' : 'ok'), queried,
      stale: data !== null && state.error !== null, returnedAtMs: now },
  };
}

export const messages: Record<ErrorCode, string> = {
  missing_key: '尚未配置 COTEMU_API_KEY', invalid_key: '密钥无效，请核对配置',
  key_disabled: '密钥已停用', owner_disabled: '密钥所属用户已停用',
  team_forbidden: '账号访问权限不足', bad_team: '查询参数异常',
  rate_limited: '请求受限，等待冷却结束', unauthorized: '身份验证失败', forbidden: '连接权限不足',
  unbound: '未找到密钥绑定的账号', wrong_platform: '绑定账号不是 OpenAI 账号',
  multiple_bound: '返回了多个绑定账号', invalid_response: '接口数据格式异常',
  network_error: '网络连接失败', timeout: '查询超时', http_error: '接口暂时不可用',
  cache_error: '本地查询状态无法保存', busy: '其他会话正在查询，请稍后再试',
};
