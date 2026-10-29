import { INTERVAL, emptyState } from './contract.js';
import { publication, type Publication } from './publication.js';

export const LEASE_MS = 120_000;
export const FAILOVER_MS = 2 * INTERVAL;
export function skipPublication(previous: Publication | null, backup: boolean, now: number): string | null {
  if (previous?.publisherLease && previous.publisherLease.expiresAtMs > now) return 'publisher_busy';
  const completed = previous?.state.lastCompletedAtMs;
  if (backup && completed != null && now - completed < FAILOVER_MS) return 'primary_recent';
  return null;
}
export function leasePublication(previous: Publication | null, owner: string, now: number): Publication {
  return { ...(previous ?? publication(emptyState(), now)), publisherLease: { owner, expiresAtMs: now + LEASE_MS } };
}
