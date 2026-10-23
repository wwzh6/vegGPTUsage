import { API_URL, INTERVAL, MIN_INTERVAL, emptyState, normalize, result, type ErrorCode, type State, type UsageResult } from './contract.js';
import { SharedStore } from './store.js';

const knownCodes = new Set(['missing_key', 'invalid_key', 'key_disabled', 'owner_disabled', 'team_forbidden', 'bad_team', 'rate_limited']);
export function retryDelay(header: string | null, now: number): number {
  if (!header?.trim()) return INTERVAL;
  const value = header.trim();
  if (/^\d+(\.\d+)?$/.test(value)) {
    const ms = Number(value) * 1000;
    return Number.isFinite(ms) ? Math.max(MIN_INTERVAL, ms) : INTERVAL;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(MIN_INTERVAL, date - now) : INTERVAL;
}

export class UsageService {
  private pending?: Promise<UsageResult>;
  readonly store: SharedStore;
  constructor(private readonly key: string | undefined, root: string,
    private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {
    this.store = new SharedStore(root, key ?? 'missing');
  }
  get(refresh = false): Promise<UsageResult> {
    if (!this.key?.trim()) return Promise.resolve(result({ ...emptyState(), error: 'missing_key', autoPaused: true }, this.now()));
    if (!this.pending) this.pending = this.query(refresh).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async query(refresh: boolean): Promise<UsageResult> {
    let current = emptyState();
    const requestedAt = this.now();
    try {
      return await this.store.locked(async () => {
        current = await this.store.read();
        const start = this.now();
        if (current.lastCompletedAtMs !== null && current.lastCompletedAtMs >= requestedAt
          && current.lastAttemptAtMs !== null && current.lastAttemptAtMs <= requestedAt)
          return result(current, start, false, current.error === 'rate_limited' ? 'cooldown' : 'recent');
        if (start < current.nextAllowedAtMs)
          return result(current, start, false, current.error === 'rate_limited' ? 'cooldown' : 'recent');
        if (!refresh && (current.autoPaused || start < current.nextRefreshAtMs)) return result(current, start);
        current.lastAttemptAtMs = start;
        current.nextAllowedAtMs = start + MIN_INTERVAL;
        current.nextRefreshAtMs = start + INTERVAL;
        await this.store.write(current);
        const signal = AbortSignal.timeout(15_000);
        try {
          const response = await this.fetcher(API_URL, {
            headers: { Authorization: `Bearer ${this.key}`, Accept: 'application/json' },
            redirect: 'error', signal,
          });
          let body: unknown = null;
          try { body = await response.json(); } catch { if (response.ok) throw new Error('invalid_response'); }
          if (!response.ok) {
            const raw = body && typeof body === 'object' ? (body as any).code : null;
            current.error = knownCodes.has(raw) ? raw : response.status === 401 ? 'unauthorized'
              : response.status === 403 ? 'forbidden' : response.status === 429 ? 'rate_limited' : 'http_error';
            current.autoPaused = response.status === 401 || response.status === 403;
            if (response.status === 429) {
              current.error = 'rate_limited';
              current.nextAllowedAtMs = this.now() + retryDelay(response.headers.get('Retry-After'), this.now());
            }
          } else {
            current.data = normalize(body, this.now());
            current.error = null;
            current.autoPaused = false;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          const semantic = ['unbound', 'wrong_platform', 'multiple_bound'];
          current.error = signal.aborted ? 'timeout' : [...semantic, 'invalid_response'].includes(message)
            ? message as ErrorCode : 'network_error';
          if (semantic.includes(message)) current.data = null;
        }
        current.lastCompletedAtMs = this.now();
        current.nextRefreshAtMs = current.error === 'rate_limited' ? current.nextAllowedAtMs : this.now() + INTERVAL;
        await this.store.write(current);
        return result(current, this.now(), true);
      });
    } catch (error) {
      if (!current.data) current = await this.store.read().catch(() => current);
      current.error = error instanceof Error && error.message === 'busy' ? 'busy' : 'cache_error';
      current.nextRefreshAtMs = this.now() + INTERVAL;
      return result(current, this.now());
    }
  }
}
