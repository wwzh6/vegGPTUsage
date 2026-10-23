import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import FakeTimers from '@sinonjs/fake-timers';
import { UsageController } from '../artifacts/test/ui/controller.mjs';
import { normalize, result, emptyState, INTERVAL, MIN_INTERVAL } from '../artifacts/test/contract.mjs';
import { NOW, body } from './fixture.mjs';

const html = await readFile(new URL('../src/ui/index.html', import.meta.url), 'utf8');
function snapshot(overrides = {}) {
  return result({ ...emptyState(), data: normalize(body(), Date.now()),
    lastAttemptAtMs: Date.now(), lastCompletedAtMs: Date.now(), nextAllowedAtMs: Date.now() + MIN_INTERVAL,
    nextRefreshAtMs: Date.now() + INTERVAL, ...overrides }, Date.now(), true);
}
function setup(t, query) {
  const clock = FakeTimers.install({ now: NOW, toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  let calls = []; let closes = 0;
  const controller = new UsageController(dom.window.document, {
    query: async manual => { calls.push({ at: Date.now(), manual }); return query ? query(manual) : snapshot(); },
    close: async () => { closes++; },
  });
  t.after(() => { controller.destroy(); dom.window.close(); clock.uninstall(); });
  return { clock, dom, controller, calls, closes: () => closes, text: id => dom.window.document.getElementById(id).textContent };
}

test('initial result renders without a duplicate query; automatic cadence is ten minutes', async t => {
  const { clock, controller, calls, text } = setup(t);
  controller.accept(snapshot()); assert.equal(text('percent'), '40%');
  await clock.tickAsync(INTERVAL - 1); assert.equal(calls.length, 0);
  await clock.tickAsync(1); assert.equal(calls.length, 1); assert.equal(calls[0].manual, false);
  await clock.tickAsync(INTERVAL); assert.equal(calls.length, 2);
});

test('manual refresh floor and restarted schedule; rejected clicks do not shift schedule', async t => {
  const { clock, controller, calls, text } = setup(t);
  controller.accept(snapshot());
  await clock.tickAsync(14_000); await controller.refresh(true);
  assert.equal(calls.length, 0); assert.equal(text('countdown'), '刚刚查询');
  await clock.tickAsync(106_000); await controller.refresh(true); assert.equal(calls.length, 1);
  await clock.tickAsync(INTERVAL - 1); assert.equal(calls.length, 1);
  await clock.tickAsync(1); assert.equal(calls.length, 2);
});

test('hidden views stop querying and catch up once on visibility restoration', async t => {
  const { clock, controller, calls } = setup(t);
  controller.accept(snapshot()); controller.setHidden(true);
  await clock.tickAsync(3 * INTERVAL); assert.equal(calls.length, 0);
  controller.setHidden(false); await clock.tickAsync(0);
  assert.equal(calls.length, 1);
});

test('close stops timers, requests teardown, and supports reopening if host keeps panel', async t => {
  const { clock, controller, calls, closes, dom } = setup(t);
  controller.accept(snapshot()); await controller.close();
  assert.equal(closes(), 1); assert.equal(dom.window.document.getElementById('percent').textContent, '已关闭');
  await clock.tickAsync(3 * INTERVAL); assert.equal(calls.length, 0);
  await controller.reopen(); assert.equal(calls.length, 1);
  assert.equal(dom.window.document.getElementById('percent').textContent, '40%');
  await clock.tickAsync(INTERVAL); assert.equal(calls.length, 2);
});

test('close during an in-flight query never restarts timers', async t => {
  let resolve;
  const { clock, controller, calls, dom } = setup(t, () => new Promise(r => { resolve = r; }));
  controller.accept(snapshot()); await clock.tickAsync(MIN_INTERVAL);
  const pending = controller.refresh(true);
  assert.equal(dom.window.document.getElementById('ball').disabled, true);
  await controller.refresh(true); assert.equal(calls.length, 1);
  await controller.close(); resolve(snapshot()); await pending;
  await clock.tickAsync(3 * INTERVAL); assert.equal(calls.length, 1);
});

test('429 blocks manual requests and retries once when cooldown expires', async t => {
  const { clock, controller, calls } = setup(t);
  controller.accept(snapshot({ error: 'rate_limited', nextAllowedAtMs: NOW + 120_000, nextRefreshAtMs: NOW + 120_000 }));
  await clock.tickAsync(119_999); await controller.refresh(true); assert.equal(calls.length, 0);
  await clock.tickAsync(1); assert.equal(calls.length, 1);
});

test('authorization errors disable automatic refresh but allow manual recovery', async t => {
  const { clock, controller, calls } = setup(t);
  controller.accept(snapshot({ error: 'invalid_key', autoPaused: true }));
  await clock.tickAsync(3 * INTERVAL); assert.equal(calls.length, 0);
  await controller.refresh(true); assert.equal(calls.length, 1);
  await clock.tickAsync(INTERVAL); assert.equal(calls.length, 2);
});

test('bridge errors retain old data, flag it, and avoid immediate retry loops', async t => {
  const { clock, controller, calls, text, dom } = setup(t, () => { throw new Error('bridge disconnected'); });
  controller.accept(snapshot()); await clock.tickAsync(MIN_INTERVAL); await controller.refresh(true);
  assert.equal(text('percent'), '40%'); assert.match(dom.window.document.getElementById('ball').title, /旧数据/);
  await clock.tickAsync(INTERVAL - 1); assert.equal(calls.length, 1);
  await clock.tickAsync(1); assert.equal(calls.length, 2);
});

test('countdown and aging update locally without network calls', async t => {
  const { clock, controller, calls, text, dom } = setup(t);
  const data = snapshot({ autoPaused: true });
  data.data.resetsAtMs = NOW + 60_000;
  controller.accept(data);
  await clock.tickAsync(60_000); assert.equal(text('countdown'), '已到期，待更新');
  assert.equal(text('percent'), '40%');
  await clock.tickAsync(600_000); assert.match(dom.window.document.getElementById('ball').title, /可能过时/); assert.equal(calls.length, 0);
});

test('wall clock adjustments do not shift server-based countdown', async t => {
  const { clock, controller, text } = setup(t);
  const data = snapshot({ autoPaused: true }); data.data.resetsAtMs = NOW + 60_000;
  controller.accept(data); clock.setSystemTime(NOW + 86_400_000);
  await clock.tickAsync(1000); assert.equal(text('countdown'), '1分钟');
});

test('an occluded iframe stays paused even when its document reports visible', async t => {
  const { clock, controller, calls, dom } = setup(t);
  controller.accept(snapshot()); controller.setOccluded(true);
  dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
  await clock.tickAsync(INTERVAL * 2); assert.equal(calls.length, 0);
  controller.setOccluded(false); await clock.tickAsync(0); assert.equal(calls.length, 1);
});

test('compact UI contains only the ring and two text lines; details remain accessible', t => {
  const { controller, dom } = setup(t);
  controller.accept(snapshot());
  const doc = dom.window.document;
  assert.equal(doc.title, '植被组额度查询');
  assert.equal(doc.querySelectorAll('button').length, 1);
  assert.equal(doc.querySelectorAll('.center > span').length, 2);
  assert.equal(doc.querySelector('header, footer, #notice, #flags, #reset-label'), null);
  assert.match(doc.getElementById('ball').getAttribute('aria-label'), /账号共享七天用量/);
});

test('missing key and bridge initialization failure are visible within the two lines', t => {
  const { controller, text } = setup(t);
  controller.failBridge();
  assert.equal(text('countdown'), '连接失败，点击重试');
  controller.accept(snapshot({ data: null, error: 'missing_key', autoPaused: true }));
  assert.equal(text('percent'), '用量未知');
  assert.equal(text('countdown'), '未配置密钥');
});

test('reference-only and stale data are identified without extra UI rows', t => {
  const { controller, text, dom } = setup(t);
  const value = snapshot(); value.data.enforced = false;
  controller.accept(value);
  assert.match(text('countdown'), /^参考 · /);
  value.query.error = 'network_error'; value.query.stale = true;
  controller.accept(value);
  assert.match(text('countdown'), /^旧 · /);
  assert.match(dom.window.document.getElementById('ball').title, /仅供参考/);
});

test('Escape closes the ring and clicking it reopens with the same rate limit', async t => {
  const { controller, dom, clock, calls, closes, text } = setup(t);
  controller.accept(snapshot());
  const ball = dom.window.document.getElementById('ball');
  ball.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(closes(), 1); assert.equal(text('percent'), '已关闭');
  ball.click(); await clock.tickAsync(0);
  assert.equal(calls.length, 0); assert.equal(text('percent'), '40%');
  await clock.tickAsync(INTERVAL); assert.equal(calls.length, 1);
});
