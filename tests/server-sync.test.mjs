import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

for (const mode of ['scheduled-cache', 'recent', 'paused', 'cooldown', 'upstream-error', 'publisher-busy', 'backup-fresh', 'backup-stale', 'backup-forced']) {
  test(`server publisher preserves safety and fixed timer cadence (${mode})`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'vegetation-server-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const log = join(root, 'published.json');
    const output = spawnSync(process.execPath, ['--import', pathToFileURL(resolve('tests/sync-fixture.mjs')).href, 'scripts/server-sync.mjs'], {
      encoding: 'utf8', timeout: 25_000, windowsHide: true,
      env: { ...process.env, GITHUB_TOKEN: 'synthetic-github-token',
        COTEMU_API_KEY: 'synthetic-account-key', VEGETATION_MANUAL_REFRESH: 'false',
        VEGETATION_BACKUP_ONLY: String(mode.startsWith('backup-')), VEGETATION_FORCE_TAKEOVER: String(mode === 'backup-forced'),
        TEST_SYNC_MODE: mode, TEST_SYNC_LOG: log } });
    const success = ['scheduled-cache', 'recent', 'publisher-busy', 'backup-fresh', 'backup-stale', 'backup-forced'].includes(mode);
    assert.equal(output.status, success ? 0 : 1, output.stderr);
    assert.doesNotMatch(output.stdout + output.stderr, /synthetic-account-key|synthetic-github-token|PRIVATE BODY/);
    if (['publisher-busy', 'backup-fresh'].includes(mode)) {
      await assert.rejects(readFile(log), { code: 'ENOENT' });
      assert.match(output.stdout, /publisher_busy|primary_recent/);
    } else {
      const record = JSON.parse(await readFile(log, 'utf8'));
      assert.equal(record.upstreamCalls, ['scheduled-cache', 'upstream-error', 'backup-stale', 'backup-forced'].includes(mode) ? 1 : 0);
      assert.equal(record.saved.publisherLease, undefined);
      assert.equal(record.saved.state.data.usedPercent, 40);
      assert.equal(record.saved.state.error, ['upstream-error', 'paused'].includes(mode) ? 'invalid_key'
        : mode === 'cooldown' ? 'rate_limited' : null);
    }
  });
}
