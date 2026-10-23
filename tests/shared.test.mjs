import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedUsageService } from '../artifacts/test/shared-service.mjs';
import { publication, decodePublication } from '../artifacts/test/publication.mjs';
import { emptyState, normalize, INTERVAL, MIN_INTERVAL } from '../artifacts/test/contract.mjs';
import { NOW, body } from './fixture.mjs';

function published(overrides = {}) {
  return publication({ ...emptyState(), data: normalize(body(), NOW), lastAttemptAtMs: NOW,
    lastCompletedAtMs: NOW, nextAllowedAtMs: NOW + MIN_INTERVAL, nextRefreshAtMs: NOW + INTERVAL, ...overrides }, NOW);
}
function response(value = published(), date = NOW) {
  return new Response(JSON.stringify(value), { headers: { Date: new Date(date).toUTCString() } });
}
async function setup(t, fetcher, credential = async () => 'synthetic-github-reader') {
  const root = await mkdtemp(join(tmpdir(), 'vegetation-shared-')); let time = NOW;
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new SharedUsageService(root, credential, fetcher, () => time);
  return { service, root, setTime: value => { time = value; } };
}

test('GitHub reader sends only GitHub credentials to the fixed snapshot URL', async t => {
  const seen = [];
  const { service } = await setup(t, async (url, options) => { seen.push({ url, options }); return response(); });
  const result = await service.get(true);
  assert.equal(result.data.usedPercent, 40);
  assert.equal(seen[0].url, 'https://api.github.com/repos/wwzh6/vegGPTUsage/contents/usage.json?ref=quota-data');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer synthetic-github-reader');
  assert.equal(seen[0].options.redirect, 'error');
  assert.ok(!JSON.stringify(result).includes('synthetic-github-reader'));
  assert.ok(!(await readFile(join(service.store.directory, 'state.json'), 'utf8')).includes('synthetic-github-reader'));
});

test('missing GitHub login does not contact any endpoint or require an upstream account key', async t => {
  let requests = 0;
  const { service } = await setup(t, async () => { requests++; return response(); }, async () => null);
  const result = await service.get(true);
  assert.equal(result.query.error, 'shared_auth_required'); assert.equal(result.query.autoPaused, true);
  assert.equal(requests, 0);
});

test('GitHub Date establishes server time despite a client clock ten days ahead', async t => {
  const { service, setTime } = await setup(t, async () => response(published(), NOW + 5 * 60_000));
  setTime(NOW + 10 * 86400_000);
  const result = await service.get(true);
  assert.equal(result.serverNowMs, NOW + 5 * 60_000);
  assert.equal(result.data.resetsAtMs, NOW + 3 * 86400_000);
  assert.equal(result.query.returnedAtMs, NOW + 10 * 86400_000);
});

test('delayed publication and unknown HTTP time never look freshly queried', async t => {
  let next = response(published(), NOW + INTERVAL + 1000);
  const { service, setTime } = await setup(t, async () => next);
  assert.equal((await service.get(true)).query.error, 'shared_stale');
  setTime(NOW + MIN_INTERVAL); next = new Response(JSON.stringify(published()));
  const value = await service.get(true);
  assert.equal(value.query.error, 'shared_time_unknown'); assert.equal(value.serverNowMs, null);
});

test('corrupt and failed snapshots preserve old data; no raw response enters the cache', async t => {
  let next = response();
  const { service, setTime } = await setup(t, async () => next);
  await service.get(true); setTime(NOW + MIN_INTERVAL);
  next = new Response('PRIVATE ERROR BODY', { status: 500 });
  const failed = await service.get(true);
  assert.equal(failed.data.usedPercent, 40); assert.equal(failed.query.stale, true);
  setTime(NOW + 2 * MIN_INTERVAL); next = new Response('{"secret":"PRIVATE ERROR BODY"}');
  assert.equal((await service.get(true)).data.usedPercent, 40);
  assert.ok(!(await readFile(join(service.store.directory, 'state.json'), 'utf8')).includes('PRIVATE ERROR BODY'));
});

test('publication parser projects only allowed fields and rejects invalid envelopes', () => {
  const raw = published(); raw.secret = 'must-not-publish'; raw.state.data.secret = 'must-not-publish';
  raw.state.extra = ['account-list'];
  assert.ok(!JSON.stringify(decodePublication(raw)).includes('must-not-publish'));
  assert.ok(!JSON.stringify(decodePublication(raw)).includes('account-list'));
  assert.throws(() => decodePublication({ ...raw, version: 2 }));
  assert.throws(() => decodePublication({ ...raw, state: { ...raw.state, error: 'secret-text' } }));
});

test('shared refreshes coalesce across instances and respect ten-minute and fifteen-second limits', async t => {
  let requests = 0;
  const fetcher = async () => { requests++; return response(); };
  const { service, root, setTime } = await setup(t, fetcher);
  const other = new SharedUsageService(root, async () => 'synthetic-github-reader', fetcher, () => NOW);
  await Promise.all([service.get(true), other.get(true), service.get(true)]);
  assert.equal(requests, 1);
  setTime(NOW + 14_999); await service.get(true); assert.equal(requests, 1);
  setTime(NOW + INTERVAL - 1); await service.get(false); assert.equal(requests, 1);
  setTime(NOW + INTERVAL); await service.get(false); assert.equal(requests, 2);
});

test('GitHub rate limits apply to manual reads and authentication can recover manually', async t => {
  let requests = 0;
  let next = new Response('', { status: 429, headers: { 'Retry-After': '120' } });
  const { service, setTime } = await setup(t, async () => { requests++; return next; });
  const limited = await service.get(true); assert.equal(limited.query.nextAllowedAtMs, NOW + 120_000);
  setTime(NOW + 119_999); await service.get(true); assert.equal(requests, 1);
  setTime(NOW + 120_000); next = new Response('', { status: 401 });
  assert.equal((await service.get(true)).query.autoPaused, true);
  setTime(NOW + INTERVAL); await service.get(false); assert.equal(requests, 2);
  next = response(); assert.equal((await service.get(true)).query.autoPaused, false);
});

test('upstream pause is published but clients keep checking for administrator recovery', async t => {
  const { service } = await setup(t, async () => response(published({ error: 'invalid_key', autoPaused: true })));
  const value = await service.get(true);
  assert.equal(value.query.error, 'invalid_key'); assert.equal(value.query.autoPaused, false);
  assert.equal(value.query.stale, true);
});

test('upstream cooldown does not turn snapshot polling into a fifteen-second loop', async t => {
  const { service } = await setup(t, async () => response(published({ error: 'rate_limited', nextAllowedAtMs: NOW + 120_000 })));
  const value = await service.get(true);
  assert.equal(value.query.error, 'shared_sync_limited');
  assert.equal(value.query.nextRefreshAtMs, NOW + INTERVAL);
});
