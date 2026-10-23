import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageService, retryDelay } from '../artifacts/test/service.mjs';
import { normalize, INTERVAL, MIN_INTERVAL, result, emptyState } from '../artifacts/test/contract.mjs';
import { view } from '../artifacts/test/ui/controller.mjs';
import { NOW, account, body, reply } from './fixture.mjs';

async function setup(t, fetcher, key = 'synthetic-test-key') {
  const root = await mkdtemp(join(tmpdir(), 'cotemu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let now = NOW;
  return { root, service: new UsageService(key, root, fetcher, () => now), advance: ms => { now += ms; } };
}

test('selects the bound OpenAI account, never an unbound alternative', () => {
  assert.equal(normalize(body([account({ bound: false, seven_day: { used_percent: 99 } }), account()]), NOW).usedPercent, 40);
  for (const [accounts, code] of [[[], 'unbound'], [[account({ bound: false })], 'unbound'],
    [[account({ platform: 'anthropic' }), account({ bound: false })], 'wrong_platform'],
    [[account(), account()], 'multiple_bound']]) assert.throws(() => normalize(body(accounts), NOW), new RegExp(code));
});

test('validates windows and numbers independently without coercion or clamping', () => {
  for (const value of [null, undefined, -1, 101, NaN, Infinity, '40', false])
    assert.equal(normalize(body([account({ seven_day: { used_percent: value, resets_at_ms: NOW } })]), NOW).usedPercent, null);
  for (const value of [0, 0.1, 100]) assert.equal(normalize(body([account({ seven_day: { used_percent: value } })]), NOW).usedPercent, value);
  assert.equal(normalize(body([account({ seven_day: null })]), NOW).resetsAtMs, null);
  assert.equal(normalize(body([account({ seven_day: { used_percent: 40, resets_at_ms: '123' } })]), NOW).resetsAtMs, null);
  assert.equal(normalize(body([account({ updated_at_ms: NOW + 1 })]), NOW).updatedAtMs, null);
});

test('derived countdown uses server time and does not substitute resume time or reset percentage locally', () => {
  const data = normalize(body([account({ seven_day: { used_percent: 42, resets_at_ms: NOW + 60_000, enforced: false } })]), NOW + 9_000_000);
  const value = result({ ...emptyState(), data }, NOW + 9_000_000);
  assert.equal(view(value, 0).countdown, '1分钟');
  assert.equal(view(value, 60_000).countdown, '已到重置时间，待更新');
  assert.equal(view(value, 60_000).percent, '42%');
  assert.ok(view(value, 0).flags.includes('仅供参考'));
  assert.ok(view(value, 600_000).flags.includes('可能过时'));
  value.data.resetsAtMs = null;
  assert.equal(view(value, 0).countdown, '时间未知');
});

test('missing key makes no network request and pauses auto refresh', async t => {
  const { service } = await setup(t, () => { throw new Error('must not request'); }, undefined);
  const missing = new UsageService(undefined, service.store.directory);
  const r = await missing.get(true);
  assert.equal(r.query.error, 'missing_key'); assert.equal(r.query.autoPaused, true);
});

test('request has exact URL/header, follows no redirects, and leaks no account list or key', async t => {
  const key = 'synthetic-secret-must-not-leak';
  const { service } = await setup(t, async (url, options) => {
    assert.equal(url, 'https://cotemu.com/api/open/accounts');
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
    return reply();
  }, key);
  const r = await service.get(true);
  const saved = await readFile(join(service.store.directory, 'state.json'), 'utf8');
  for (const text of [JSON.stringify(r), saved]) {
    assert.ok(!text.includes(key)); assert.ok(!text.includes('REDACTED-ACCOUNT-NAME'));
    assert.ok(!text.includes('resume_at_ms')); assert.ok(!text.includes('accounts'));
  }
});

test('automatic interval and manual 15-second floor persist across service instances', async t => {
  let calls = 0;
  const mock = async () => { calls++; return reply(); };
  const { service, root, advance } = await setup(t, mock);
  await service.get(true); advance(14_999);
  assert.equal((await service.get(true)).query.state, 'recent');
  advance(1); await service.get(false); assert.equal(calls, 1);
  await service.get(true); assert.equal(calls, 2);
  const second = new UsageService('synthetic-test-key', root, mock, () => NOW + 15_000);
  await second.get(true); assert.equal(calls, 2);
  advance(INTERVAL); await service.get(false); assert.equal(calls, 3);
});

test('simultaneous calls in the same process are merged', async t => {
  let calls = 0;
  const { service } = await setup(t, async () => { calls++; await new Promise(r => setTimeout(r, 30)); return reply(); });
  const values = await Promise.all(Array.from({ length: 8 }, () => service.get(true)));
  assert.equal(calls, 1); assert.ok(values.every(v => v.data.usedPercent === 40));
});

test('network/HTTP/format failures preserve and label old data', async t => {
  let response = () => reply();
  const { service, advance } = await setup(t, async () => response());
  await service.get(true);
  for (const [makeResponse, code] of [
    [() => { throw new Error('secret=should-not-leak'); }, 'network_error'],
    [() => reply({ detail: 'secret=should-not-leak' }, 503), 'http_error'],
    [() => new Response('<html>private</html>'), 'invalid_response'],
    [() => reply({ accounts: 'invalid' }), 'invalid_response'],
  ]) {
    response = makeResponse; advance(INTERVAL);
    const r = await service.get(false);
    assert.equal(r.query.error, code); assert.equal(r.query.stale, true);
    assert.equal(r.data.usedPercent, 40); assert.ok(!JSON.stringify(r).includes('should-not-leak'));
    assert.equal(r.query.nextRefreshAtMs - r.query.lastCompletedAtMs, INTERVAL);
  }
});

test('a newly missing binding clears previous account data', async t => {
  let data = body(); const { service, advance } = await setup(t, async () => reply(data));
  await service.get(true); data = body([]); advance(MIN_INTERVAL);
  const r = await service.get(true);
  assert.equal(r.data, null); assert.equal(r.query.error, 'unbound');
});

for (const [status, code] of [[401, 'invalid_key'], [403, 'owner_disabled']]) {
  test(`${status} uses top-level code and pauses until a successful manual retry`, async t => {
    let calls = 0; let valid = false;
    const { service, advance } = await setup(t, async () => { calls++; return valid ? reply() : reply({ code, detail: 'do not expose' }, status); });
    assert.equal((await service.get(true)).query.error, code);
    advance(INTERVAL); assert.equal((await service.get()).query.autoPaused, true); assert.equal(calls, 1);
    valid = true; assert.equal((await service.get(true)).query.autoPaused, false); assert.equal(calls, 2);
  });
}

test('429 cooldown cannot be bypassed and missing Retry-After defaults to ten minutes', async t => {
  let calls = 0;
  const { service, advance } = await setup(t, async () => { calls++; return calls === 1 ? reply({ code: 'rate_limited' }, 429, { 'Retry-After': '120' }) : reply(); });
  const first = await service.get(true);
  assert.equal(first.query.nextRefreshAtMs, NOW + 120_000);
  advance(119_999); assert.equal((await service.get(true)).query.state, 'cooldown'); assert.equal(calls, 1);
  advance(1); await service.get(); assert.equal(calls, 2);
  assert.equal(retryDelay(null, NOW), INTERVAL); assert.equal(retryDelay('invalid', NOW), INTERVAL);
  assert.equal(retryDelay(new Date(NOW + 120_000).toUTCString(), NOW), 120_000);
});

test('request timeout is 15 seconds and produces a safe timeout result', async t => {
  const original = AbortSignal.timeout;
  AbortSignal.timeout = ms => { assert.equal(ms, 15_000); return AbortSignal.abort(); };
  t.after(() => { AbortSignal.timeout = original; });
  const { service } = await setup(t, async (_url, options) => { options.signal.throwIfAborted(); });
  assert.equal((await service.get(true)).query.error, 'timeout');
});

test('distinct keys have isolated caches', async t => {
  const { root, service } = await setup(t, async () => reply());
  await service.get(true);
  const other = new UsageService('different-key', root, async () => reply(body([])), () => NOW);
  assert.equal((await other.get()).data, null);
  assert.equal((await readdir(root)).length, 2);
});

test('lock contention preserves the previous successful snapshot', async t => {
  const { service, advance } = await setup(t, async () => reply());
  await service.get(true); advance(INTERVAL);
  service.store.locked = async () => { throw new Error('busy'); };
  const r = await service.get(true);
  assert.equal(r.data.usedPercent, 40); assert.equal(r.query.stale, true); assert.equal(r.query.error, 'busy');
});
