import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

for (const mode of ['scheduled-cache', 'recent', 'paused', 'cooldown', 'upstream-error', 'active-workflow', 'running-workflow']) {
  test(`server publisher preserves safety and fixed timer cadence (${mode})`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'vegetation-server-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const log = join(root, 'published.json');
    const output = spawnSync(process.execPath, ['--import', pathToFileURL(resolve('tests/sync-fixture.mjs')).href, 'scripts/server-sync.mjs'], {
      encoding: 'utf8', timeout: 25_000, windowsHide: true,
      env: { ...process.env, GITHUB_TOKEN: 'synthetic-github-token',
        COTEMU_API_KEY: 'synthetic-account-key', VEGETATION_MANUAL_REFRESH: 'false', TEST_SYNC_MODE: mode, TEST_SYNC_LOG: log } });
    const success = ['scheduled-cache', 'recent'].includes(mode);
    assert.equal(output.status, success ? 0 : 1, output.stderr);
    assert.doesNotMatch(output.stdout + output.stderr, /synthetic-account-key|synthetic-github-token|PRIVATE BODY/);
    if (mode.endsWith('-workflow')) {
      await assert.rejects(readFile(log), { code: 'ENOENT' });
      assert.match(output.stderr, /workflow_still_active|workflow_busy/);
    } else {
      const record = JSON.parse(await readFile(log, 'utf8'));
      assert.equal(record.upstreamCalls, ['scheduled-cache', 'upstream-error'].includes(mode) ? 1 : 0);
      assert.equal(record.saved.state.data.usedPercent, 40);
      assert.equal(record.saved.state.error, ['upstream-error', 'paused'].includes(mode) ? 'invalid_key'
        : mode === 'cooldown' ? 'rate_limited' : null);
    }
  });
}
