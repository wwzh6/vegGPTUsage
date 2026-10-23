import { emptyState, messages, normalize, timestamp, type ErrorCode, type State } from './contract.js';

export interface Publication { version: 1; publishedAtMs: number; state: State }

export function decodePublication(value: unknown): Publication {
  const item = value as any;
  const publishedAtMs = timestamp(item?.publishedAtMs);
  const raw = item?.state;
  if (item?.version !== 1 || publishedAtMs === null || !raw || typeof raw.autoPaused !== 'boolean'
    || !Number.isSafeInteger(raw.nextAllowedAtMs) || raw.nextAllowedAtMs < 0
    || !Number.isSafeInteger(raw.nextRefreshAtMs) || raw.nextRefreshAtMs < 0
    || (raw.error !== null && !Object.hasOwn(messages, raw.error))) throw new Error('invalid_response');
  const state: State = { ...emptyState(), lastAttemptAtMs: timestamp(raw.lastAttemptAtMs),
    lastCompletedAtMs: timestamp(raw.lastCompletedAtMs), nextAllowedAtMs: raw.nextAllowedAtMs,
    nextRefreshAtMs: raw.nextRefreshAtMs, autoPaused: raw.autoPaused, error: raw.error as ErrorCode | null };
  if (raw.data !== null) {
    const data = raw.data;
    const sampledAtMs = timestamp(data?.sampledAtMs);
    if (!data || sampledAtMs === null) throw new Error('invalid_response');
    state.data = normalize({ server_ms: data.serverMs, accounts: [{ bound: true, platform: 'openai',
      status: data.accountStatus, updated_at_ms: data.updatedAtMs,
      seven_day: { used_percent: data.usedPercent, resets_at_ms: data.resetsAtMs, enforced: data.enforced } }] }, sampledAtMs);
  }
  return { version: 1, publishedAtMs, state };
}

export function publication(state: State, now: number): Publication {
  return decodePublication({ version: 1, publishedAtMs: now, state });
}
