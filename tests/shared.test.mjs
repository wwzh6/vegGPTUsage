import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedUsageService } from '../artifacts/test/shared-service.mjs';
import { publication, decodePublication } from '../artifacts/test/publication.mjs';
import { emptyState, normalize, INTERVAL, MIN_INTERVAL } from '../artifacts/test/contract.mjs';
import { NOW, body } from './fixture.mjs';
import { parseNotices } from '../artifacts/test/notices.mjs';

const withNotices = (fetcher, notices = async () => new Response('')) =>
  (url, options) => url.includes('/NOTICE.md?') ? notices(url, options) : fetcher(url, options);

function published(overrides = {}) {
  return publication({ ...emptyState(), data: normalize(body(), NOW), lastAttemptAtMs: NOW,
    lastCompletedAtMs: NOW, nextAllowedAtMs: NOW + MIN_INTERVAL, nextRefreshAtMs: NOW + INTERVAL, ...overrides }, NOW);
}
function response(value = published(), date = NOW) {
  return new Response(JSON.stringify(value), { headers: { Date: new Date(date).toUTCString() } });
}
async function setup(t, fetcher, credential = async () => 'synthetic-github-reader', notices) {
  const root = await mkdtemp(join(tmpdir(), 'vegetation-shared-')); let time = NOW;
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new SharedUsageService(root, credential, withNotices(fetcher, notices), () => time, null);
  return { service, root, setTime: value => { time = value; } };
}

test('public GitHub reader avoids credential lookup and uses the fixed snapshot URL', async t => {
  const seen = [];
  const { service } = await setup(t, async (url, options) => { seen.push({ url, options }); return response(); });
  const result = await service.get(true);
  assert.equal(result.data.usedPercent, 40);
  assert.equal(seen[0].url, 'https://api.github.com/repos/wwzh6/vegGPTUsage/contents/usage.json?ref=quota-data');
  assert.equal(seen[0].options.headers.Authorization, undefined);
  assert.equal(seen[0].options.redirect, 'error');
  assert.ok(!JSON.stringify(result).includes('synthetic-github-reader'));
  assert.ok(!(await readFile(join(service.store.directory, 'state.json'), 'utf8')).includes('synthetic-github-reader'));
});

test('public snapshots can be read without GitHub login or an upstream account key', async t => {
  let requests = 0;
  const { service } = await setup(t, async (url, options) => {
    requests++; assert.equal(options.headers.Authorization, undefined); return response();
  }, async () => null, async (url, options) => {
    assert.equal(options.headers.Authorization, undefined); return new Response('## Public notice\nHello');
  });
  const result = await service.get(true);
  assert.equal(result.query.error, null); assert.equal(result.query.autoPaused, false);
  assert.equal(requests, 1); assert.equal(result.notices.cards[0].text, 'Hello');
});

test('private snapshots still require repository access', async t => {
  const { service } = await setup(t, async () => new Response('', { status: 404 }), async () => null);
  const value = await service.get(true);
  assert.equal(value.query.error, 'shared_auth_required'); assert.equal(value.query.autoPaused, true);
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
  const other = new SharedUsageService(root, async () => 'synthetic-github-reader', withNotices(fetcher), () => NOW, null);
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
  setTime(NOW + INTERVAL); await service.get(false); assert.equal(requests, 3);
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

test('notice document parsing bounds content and preserves plain text', () => {
  assert.deepEqual(parseNotices('# Group\r\n\r\n## First\r\nHello\r\n\r\n## Second\n<img src=x>'),
    [{ title: 'First', text: 'Hello' }, { title: 'Second', text: '<img src=x>' }]);
  assert.deepEqual(parseNotices(''), []);
  for (const invalid of ['missing heading', '## '+ 'a'.repeat(81), '## One\n'+'x'.repeat(4001),
    Array.from({length:7},(_,i)=>'## '+i).join('\n'), '字'.repeat(20000)]) assert.throws(() => parseNotices(invalid));
});

test('notices refresh with quota, share throttling and cache, and survive document errors', async t => {
  let requests = 0; let document = '## Group\nFirst'; let failure = false;
  const {service, root, setTime} = await setup(t, async () => response(), undefined, async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/wwzh6/vegGPTUsage/contents/NOTICE.md?ref=main');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, undefined);
    requests++; return failure ? new Response('private error', {status:500}) : new Response(document);
  });
  assert.equal((await service.get(true)).notices.cards[0].text, 'First');
  await service.get(true); assert.equal(requests, 1);
  setTime(NOW+MIN_INTERVAL); document='## Group\nSecond';
  assert.equal((await service.get(true)).notices.cards[0].text, 'Second');
  setTime(NOW+MIN_INTERVAL*2); failure=true;
  const failed=await service.get(true);
  assert.equal(failed.notices.cards[0].text,'Second'); assert.equal(failed.notices.error,'unavailable');
  assert.equal(failed.query.error,null);
  assert.ok(!JSON.stringify(failed).includes('private error'));
  const other=new SharedUsageService(root,async()=>{throw Error('must use cache');},async()=>{throw Error('must use cache');},()=>NOW+MIN_INTERVAL*2+1, null);
  assert.deepEqual((await other.get(false)).notices,failed.notices);
  setTime(NOW+INTERVAL*2); failure=false; document='';
  assert.deepEqual((await service.get(false)).notices.cards,[]);
});

test('notice updates remain available when quota fails and rate limits stop both requests', async t => {
  let limited=false;
  const {service,setTime}=await setup(t,async()=>new Response('',{status:500}),undefined,async()=>limited
    ?new Response('',{status:429,headers:{'Retry-After':'180'}}):new Response('## News\nAvailable'));
  const value=await service.get(true);
  assert.equal(value.query.error,'shared_unavailable'); assert.equal(value.notices.cards[0].text,'Available');
  setTime(NOW+MIN_INTERVAL); limited=true;
  const blocked=await service.get(true);
  assert.equal(blocked.query.error,'rate_limited'); assert.equal(blocked.query.nextAllowedAtMs,NOW+MIN_INTERVAL+180000);
  assert.equal(blocked.notices.cards[0].text,'Available');
});
