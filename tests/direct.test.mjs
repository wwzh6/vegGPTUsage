import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSnapshot } from '../artifacts/test/snapshot-reader.mjs';
import { snapshotServer } from '../artifacts/test/snapshot-server.mjs';
import { SharedUsageService } from '../artifacts/test/shared-service.mjs';
import { emptyState, normalize, INTERVAL } from '../artifacts/test/contract.mjs';
import { publication } from '../artifacts/test/publication.mjs';
import { NOW, body } from './fixture.mjs';

const primary = 'https://snowsports.top/vegetation-quota/usage.json';
const payload = (at = NOW) => publication({ ...emptyState(), data: normalize(body(), at), lastCompletedAtMs: at }, at);
const reply = (at = NOW, date = NOW) => new Response(JSON.stringify(payload(at)), { headers: { Date: new Date(date).toUTCString() } });
async function temp(t) {
  const path = await mkdtemp(join(tmpdir(), 'vegetation-direct-'));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}

test('healthy primary never receives credentials or requests the GitHub snapshot', async () => {
  const result = await readSnapshot(primary, async (url, options) => {
    assert.equal(url, primary); assert.deepEqual(options.headers, { Accept: 'application/json', 'User-Agent': 'VegetationQuota' });
    assert.equal(options.redirect, 'error'); return reply();
  }, async () => { throw new Error('must not request backup'); });
  assert.equal((await result.json()).state.data.usedPercent, 40);
});

for (const mode of ['network', 'invalid', 'http', 'stale', 'unknown-time']) {
  test(`primary ${mode} falls back to validated GitHub data`, async () => {
    let backups = 0;
    const result = await readSnapshot(primary, async () => {
      if (mode === 'network') throw new Error('offline');
      if (mode === 'invalid') return new Response('PRIVATE RAW ERROR');
      if (mode === 'http') return new Response('', { status: 503 });
      if (mode === 'unknown-time') return new Response(JSON.stringify(payload()));
      return reply(NOW - 2 * INTERVAL);
    }, async () => { backups++; return reply(); });
    assert.equal(backups, 1); assert.equal((await result.json()).publishedAtMs, NOW);
  });
}

test('a stalled primary is retained only when backup is unavailable or older', async () => {
  for (const backup of [async () => { throw Error('offline'); }, async () => reply(NOW - 3 * INTERVAL)]) {
    const result = await readSnapshot(primary, async () => reply(NOW - 2 * INTERVAL), backup);
    assert.equal((await result.json()).publishedAtMs, NOW - 2 * INTERVAL);
  }
});

test('primary timeout aborts and reaches fallback within its short deadline', async () => {
  const start = performance.now();
  const result = await readSnapshot(primary, async (_url, { signal }) => new Promise((_resolve, reject) => {
    const handle = setTimeout(() => reject(Error('deadline-missed')), 5000);
    signal.addEventListener('abort', () => { clearTimeout(handle); reject(signal.reason); }, { once: true });
  }), async () => reply());
  assert.equal((await result.json()).publishedAtMs, NOW);
  assert.ok(performance.now() - start < 4500);
});

test('direct reads keep working during a GitHub notice cooldown and do not open credential tools', async t => {
  const root = await temp(t); let time = NOW; let direct = 0; let notices = 0;
  const service = new SharedUsageService(root, async () => { throw Error('must not load credentials'); },
    async url => {
      if (url === primary) { direct++; return reply(); }
      notices++; return new Response('', { status: 429, headers: { 'Retry-After': '120' } });
    }, () => time);
  assert.equal((await service.get(true)).query.error, null);
  time += 15000;
  assert.equal((await service.get(true)).data.usedPercent, 40);
  assert.equal(direct, 2); assert.equal(notices, 1);
});

test('older primary and backup cannot roll back previously read data', async t => {
  const root = await temp(t); let time = NOW; let published = NOW;
  const service = new SharedUsageService(root, async () => null, async url => url.includes('NOTICE.md')
    ? new Response('') : reply(published), () => time);
  await service.get(true); time += 15000; published -= INTERVAL;
  const value = await service.get(true);
  assert.equal(value.query.snapshotPublishedAtMs, NOW); assert.equal(value.data.sampledAtMs, NOW);
  assert.equal(value.query.error, 'shared_unavailable');
});

test('GitHub private fallback credentials never reach the primary host', async t => {
  const root = await temp(t); let credentialCalls = 0;
  const service = new SharedUsageService(root, async () => { credentialCalls++; return 'synthetic-github-token'; },
    async (url, options) => {
      if (url === primary) { assert.equal(options.headers.Authorization, undefined); throw Error('offline'); }
      if (!options.headers.Authorization) return new Response('', { status: 404 });
      assert.ok(url.startsWith('https://api.github.com/'));
      assert.equal(options.headers.Authorization, 'Bearer synthetic-github-token');
      return url.includes('NOTICE.md') ? new Response('## Test\nHello') : reply();
    }, () => NOW);
  const value = await service.get(true);
  assert.equal(value.query.error, null); assert.equal(credentialCalls, 1);
  assert.ok(!JSON.stringify(value).includes('synthetic-github-token'));
});

test('HTTP endpoint exposes only sanitized read-only snapshot and never lists files', async t => {
  const root = await temp(t);
  const raw = payload(); raw.secret = 'PRIVATE SECRET'; raw.state.data.secret = 'PRIVATE SECRET';
  raw.publisherLease = { owner: 'test', expiresAtMs: NOW + 1000 };
  await writeFile(join(root, 'usage.json'), JSON.stringify(raw));
  const server = snapshotServer(root);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/vegetation-quota/usage.json');
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await response.text(), /PRIVATE SECRET|publisherLease/);
  for (const path of ['/', '/vegetation-quota/', '/sync.env', '/vegetation-quota/usage.json?secret=1'])
    assert.equal((await fetch(base + path)).status, 404);
  assert.equal((await fetch(base + '/vegetation-quota/usage.json', { method: 'POST' })).status, 405);
  assert.equal(await (await fetch(base + '/vegetation-quota/usage.json', { method: 'HEAD' })).text(), '');
  await writeFile(join(root, 'usage.json'), 'PRIVATE MALFORMED BODY');
  const broken = await fetch(base + '/vegetation-quota/usage.json');
  assert.equal(broken.status, 503); assert.equal(await broken.text(), '');
});
