import { INTERVAL, MIN_INTERVAL, emptyState, result, type State, type UsageResult } from './contract.js';
import { SharedStore } from './store.js';
import { decodePublication } from './publication.js';
import { REPOSITORY, SNAPSHOT_URL, githubCredential, githubFetch } from './github.js';
import { retryDelay } from './service.js';
import { NOTICE_URL, PRIMARY_SNAPSHOT_URL } from './settings.js';
import { readSnapshot } from './snapshot-reader.js';
import { parseNotices } from './notices.js';

export class SharedUsageService {
  private pending?: Promise<UsageResult>;
  readonly store: SharedStore;
  constructor(root: string, private readonly credential = githubCredential,
    private readonly fetcher: typeof fetch = githubFetch, private readonly now: () => number = Date.now,
    private readonly primaryUrl: string | null = PRIMARY_SNAPSHOT_URL) {
    this.store = new SharedStore(root, `github:${REPOSITORY}`);
  }
  get(refresh = false): Promise<UsageResult> {
    this.pending ??= this.query(refresh).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async updateNotices(current: State, request: () => Promise<Response>) {
    const previous = current.notices ?? { cards: [], fetchedAtMs: null, error: null };
    try {
      const response = await request();
      if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - this.now();
        const wait = response.headers.has('Retry-After') ? retryDelay(response.headers.get('Retry-After'), this.now())
          : reset > 0 ? Math.max(MIN_INTERVAL, reset) : INTERVAL;
        current.githubRetryAtMs = Math.max(current.githubRetryAtMs ?? 0, this.now() + wait);
        current.notices = { ...previous, error: 'rate_limited' };
      } else if (response.status === 404) {
        current.notices = { cards: [], fetchedAtMs: this.now(), error: null };
      } else {
        if (!response.ok) throw new Error('notice_unavailable');
        current.notices = { cards: parseNotices(await response.text()), fetchedAtMs: this.now(), error: null };
      }
    } catch { current.notices = { ...previous, error: 'unavailable' }; }
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
          return result(current, start, false, 'recent');
        if (start < current.nextAllowedAtMs) return result(current, start, false, current.error === 'rate_limited' ? 'cooldown' : 'recent');
        if (!refresh && (current.autoPaused || start < current.nextRefreshAtMs)) return result(current, start);
        current.lastAttemptAtMs = start;
        current.nextAllowedAtMs = start + MIN_INTERVAL;
        current.nextRefreshAtMs = start + INTERVAL;
        await this.store.write(current);
        try {
          let credential: Promise<string | null> | undefined;
          let authenticated = false;
          const headers: Record<string, string> = { Accept: 'application/vnd.github.raw+json',
            'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'VegetationQuota' };
          const request = async (url: string, timeout: number) => {
            if (this.now() < (current.githubRetryAtMs ?? 0)) return new Response('', { status: 429,
              headers: { 'Retry-After': String(Math.ceil((current.githubRetryAtMs! - this.now()) / 1000)) } });
            const options = { headers, redirect: 'error' as const, signal: AbortSignal.timeout(timeout) };
            const response = await this.fetcher(url, options);
            if ([401, 403, 404].includes(response.status) && response.headers.get('x-ratelimit-remaining') !== '0') {
              const token = await (credential ??= this.credential());
              if (token) {
                authenticated = true;
                return this.fetcher(url, { ...options, signal: AbortSignal.timeout(timeout),
                  headers: { ...headers, Authorization: `Bearer ${token}` } });
              }
            }
            return response;
          };
          const [snapshotResponse] = await Promise.allSettled([
            readSnapshot(this.primaryUrl, this.fetcher, () => request(SNAPSHOT_URL, 12_000), current.snapshotPublishedAtMs),
            this.updateNotices(current, () => request(NOTICE_URL, 8_000)),
          ]);
          if (snapshotResponse.status === 'rejected') throw new Error('snapshot_unavailable');
          const response = snapshotResponse.value;
          if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
            current.error = 'rate_limited'; current.autoPaused = false;
            const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - this.now();
            current.nextAllowedAtMs = Math.max(current.nextAllowedAtMs, this.now() + (response.headers.has('Retry-After')
              ? retryDelay(response.headers.get('Retry-After'), this.now()) : reset > 0 ? Math.max(MIN_INTERVAL, reset) : INTERVAL));
            current.githubRetryAtMs = current.nextAllowedAtMs;
          } else if (response.status === 401 || response.status === 403) {
            current.error = 'shared_auth_required'; current.autoPaused = true;
          } else if (!response.ok) {
            current.error = response.status === 404 ? authenticated ? 'shared_not_ready' : 'shared_auth_required' : 'shared_unavailable';
            current.autoPaused = current.error === 'shared_auth_required';
          } else {
            const text = await response.text();
            if (text.length > 32_768) throw new Error('invalid_response');
            const remote = decodePublication(JSON.parse(text));
            if (remote.publishedAtMs < (current.snapshotPublishedAtMs ?? 0)) throw new Error('older_snapshot');
            current.snapshotPublishedAtMs = remote.publishedAtMs;
            const networkNow = Date.parse(response.headers.get('Date') ?? '');
            const reference = Number.isFinite(networkNow) && networkNow >= remote.publishedAtMs - 1000 ? networkNow : null;
            const remoteData = remote.state.data;
            current.data = remoteData ? { ...remoteData,
              serverMs: reference !== null && remoteData.serverMs !== null && reference >= remoteData.sampledAtMs - 1000
                ? remoteData.serverMs + Math.max(0, reference - remoteData.sampledAtMs) : null,
              sampledAtMs: this.now() } : null;
            current.error = remote.state.error === 'rate_limited' ? 'shared_sync_limited' : remote.state.error ?? (reference === null ? 'shared_time_unknown'
              : reference - remote.publishedAtMs > INTERVAL ? 'shared_stale' : null);
            current.autoPaused = false;
          }
        } catch {
          current.error = 'shared_unavailable'; current.autoPaused = false;
        }
        if (!this.primaryUrl && current.notices?.error === 'rate_limited' && !current.autoPaused) {
          current.error = 'rate_limited'; current.nextAllowedAtMs = Math.max(current.nextAllowedAtMs, current.githubRetryAtMs ?? 0);
        }
        current.lastCompletedAtMs = this.now();
        current.nextRefreshAtMs = current.error === 'rate_limited' ? current.nextAllowedAtMs : this.now() + INTERVAL;
        await this.store.write(current);
        return result(current, this.now(), true);
      });
    } catch {
      if (!current.data) current = await this.store.read().catch(() => current);
      current.error = 'cache_error'; current.nextRefreshAtMs = this.now() + INTERVAL;
      return result(current, this.now());
    }
  }
}
