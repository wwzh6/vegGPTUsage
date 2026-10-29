import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { publication } from '../artifacts/test/publication.mjs';
import { emptyState, normalize } from '../artifacts/test/contract.mjs';
import { body } from './fixture.mjs';

const mode = process.env.TEST_SYNC_MODE;
const now = Date.now();
const previous = publication({ ...emptyState(), data: normalize(body(), now - 60_000),
  lastCompletedAtMs: ['backup-fresh', 'backup-forced'].includes(mode) ? now - 60_000 : mode === 'backup-stale' ? now - 1_200_001 : null,
  nextAllowedAtMs: mode === 'cooldown' ? now + 120_000 : mode === 'recent' ? now + 10_000 : 0,
  nextRefreshAtMs: mode === 'scheduled-cache' ? now + 1000 : mode === 'backup-forced' ? now + 540_000 : 0,
  error: mode === 'paused' ? 'invalid_key' : mode === 'cooldown' ? 'rate_limited' : null,
  autoPaused: mode === 'paused' }, now - 60_000);
if (mode === 'publisher-busy') previous.publisherLease = { owner: 'other-publisher', expiresAtMs: now + 60_000 };
let upstreamCalls = 0;
let saved;
globalThis.fetch = async (url, options = {}) => {
  if (url === 'https://cotemu.com/api/open/accounts') {
    upstreamCalls++;
    assert.equal(options.headers.Authorization, 'Bearer synthetic-account-key');
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify(mode === 'upstream-error' ? { code: 'invalid_key', detail: 'PRIVATE BODY' } : body()), { status: mode === 'upstream-error' ? 401 : 200 });
  }
  assert.ok(url.startsWith('https://api.github.com/repos/wwzh6/vegGPTUsage/'));
  assert.equal(options.headers.Authorization, 'Bearer synthetic-github-token');
  assert.equal(options.redirect, 'error');
  if (url.endsWith('/actions/workflows/sync-usage.yml'))
    return new Response(JSON.stringify({ state: mode === 'active-workflow' ? 'active' : 'disabled_manually' }));
  if (url.endsWith('/actions/workflows/sync-usage.yml/runs?per_page=10'))
    return new Response(JSON.stringify({ workflow_runs: [{ status: mode === 'running-workflow' ? 'in_progress' : 'completed' }] }));
  if (url.endsWith('/git/ref/heads/quota-data')) return new Response(JSON.stringify({ object: { sha: 'parent' } }), { status: mode === 'new' ? 404 : 200 });
  if (url.includes('/contents/usage.json')) return new Response(JSON.stringify({ content: Buffer.from(JSON.stringify(previous)).toString('base64') }));
  if (url.endsWith('/git/blobs')) {
    const content = JSON.parse(options.body).content;
    assert.ok(!/synthetic-account-key|synthetic-github-token|PRIVATE BODY|REDACTED-ACCOUNT-NAME/.test(content));
    saved = JSON.parse(content);
    return new Response(JSON.stringify({ sha: 'blob' }));
  }
  if (url.endsWith('/git/commits/parent') || url.endsWith('/git/commits/commit')) return new Response(JSON.stringify({ tree: { sha: 'previous-tree' } }));
  if (url.endsWith('/git/trees')) return new Response(JSON.stringify({ sha: 'tree' }));
  if (url.endsWith('/git/commits')) return new Response(JSON.stringify({ sha: 'commit' }));
  if (url.endsWith('/git/refs/heads/quota-data') || url.endsWith('/git/refs')) {
    if (options.method === 'PATCH') assert.equal(JSON.parse(options.body).force, false);
    await writeFile(process.env.TEST_SYNC_LOG, JSON.stringify({ upstreamCalls, saved }));
    return new Response('{}');
  }
  throw new Error('Unexpected endpoint');
};
