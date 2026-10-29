import test from 'node:test';
import assert from 'node:assert/strict';
import { skipPublication, leasePublication, FAILOVER_MS, LEASE_MS } from '../artifacts/test/publisher-policy.mjs';
import { publication, decodePublication } from '../artifacts/test/publication.mjs';
import { emptyState } from '../artifacts/test/contract.mjs';

test('backup waits twenty minutes and both publishers respect the same expiring lease', () => {
  const now = Date.now();
  const previous = publication({ ...emptyState(), lastCompletedAtMs: now }, now);
  assert.equal(skipPublication(previous, true, now + FAILOVER_MS - 1), 'primary_recent');
  assert.equal(skipPublication(previous, true, now + FAILOVER_MS), null);
  const leased = leasePublication(previous, 'server-1', now + FAILOVER_MS);
  assert.equal(leased.publishedAtMs, previous.publishedAtMs);
  assert.deepEqual(leased.state, previous.state);
  for (const backup of [false, true]) {
    assert.equal(skipPublication(leased, backup, now + FAILOVER_MS + LEASE_MS - 1), 'publisher_busy');
    assert.equal(skipPublication(leased, backup, now + FAILOVER_MS + LEASE_MS), null);
  }
  assert.deepEqual(decodePublication(leased), leased);
  assert.throws(() => decodePublication({ ...previous, publisherLease: { owner: '<script>', expiresAtMs: now } }));
});
