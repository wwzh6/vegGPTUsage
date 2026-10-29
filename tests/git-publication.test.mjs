import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitPublicationStore } from '../artifacts/test/git-publication.mjs';
import { emptyState } from '../artifacts/test/contract.mjs';

test('deploy-key transport preserves unrelated files and rejects concurrent publication', async t => {
  const root = await mkdtemp(join(tmpdir(), 'quota-git-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git(['init', '-q', '-b', 'quota-data']);
  await writeFile(join(root, 'usage.json'), JSON.stringify({ version: 1, publishedAtMs: Date.now(), state: emptyState() }));
  await writeFile(join(root, 'preserved.txt'), 'keep');
  git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'Initial']);
  const remote = join(root, 'remote.git');
  git(['clone', '-q', '--bare', root, remote]);
  const one = new GitPublicationStore(join(root, 'one'), remote);
  const two = new GitPublicationStore(join(root, 'two'), remote);
  const previous = await one.read();
  await two.read();
  const first = JSON.stringify({ ...previous, publishedAtMs: previous.publishedAtMs + 1000 });
  await one.publish(first);
  assert.equal(git(['--git-dir', remote, 'show', 'quota-data:usage.json']), first);
  assert.equal(git(['--git-dir', remote, 'show', 'quota-data:preserved.txt']), 'keep');
  await assert.rejects(two.publish(JSON.stringify({ ...previous, publishedAtMs: previous.publishedAtMs + 2000 })), /git_publication_failed/);
  assert.equal(git(['--git-dir', remote, 'show', 'quota-data:usage.json']), first);
  const final = JSON.stringify({ ...previous, publishedAtMs: previous.publishedAtMs + 3000 });
  await one.publish(final);
  assert.equal(git(['--git-dir', remote, 'show', 'quota-data:usage.json']), final);
});
