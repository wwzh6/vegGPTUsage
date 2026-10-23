import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

for (const mode of ['new', 'existing', 'upstream-error', 'paused', 'cooldown']) {
  test(`central worker publishes only sanitized state (${mode})`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'vegetation-sync-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const log = join(root, 'published.json');
    const output = spawnSync(process.execPath, ['--import', pathToFileURL(resolve('tests/sync-fixture.mjs')).href, 'dist/sync.mjs'], {
      encoding: 'utf8', timeout: 25_000, windowsHide: true,
      env: { ...process.env, GITHUB_TOKEN: 'synthetic-github-token', GITHUB_REPOSITORY: 'wwzh6/vegGPTUsage',
        COTEMU_API_KEY: 'synthetic-account-key', VEGETATION_MANUAL_REFRESH: 'false', TEST_SYNC_MODE: mode, TEST_SYNC_LOG: log } });
    assert.equal(output.status, 0, output.stderr);
    const data = JSON.parse(await readFile(log, 'utf8'));
    assert.equal(data.upstreamCalls, ['paused', 'cooldown'].includes(mode) ? 0 : 1);
    assert.equal(data.saved.state.data.usedPercent, 40);
    assert.equal(data.saved.state.error, ['upstream-error', 'paused'].includes(mode) ? 'invalid_key' : mode === 'cooldown' ? 'rate_limited' : null);
    assert.ok(!/synthetic-account-key|synthetic-github-token|PRIVATE BODY/.test(output.stdout + output.stderr));
  });
}
