import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

test('all prebuilt runtime checksums match packaged files', async () => {
  const hashes = JSON.parse(await readFile('runtime.sha256.json', 'utf8'));
  for (const [file, hash] of Object.entries(hashes))
    assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), hash, file);
});

test('Windows installation preflight is non-mutating and rejects a corrupted runtime', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'vegetation-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hashes = JSON.parse(await readFile('runtime.sha256.json', 'utf8'));
  for (const file of [...Object.keys(hashes), 'runtime.sha256.json', 'scripts/install.ps1', 'README.md', 'VERIFICATION.md', 'THIRD_PARTY_NOTICES.md']) {
    const dest = join(root, file); await mkdir(dirname(dest), { recursive: true }); await cp(resolve(file), dest);
  }
  const fakeCLI = join(root, 'codex-test.ps1');
  await writeFile(fakeCLI, "if (($args -join ' ') -ne 'plugin add --help') { throw 'Unexpected mutation' }; exit 0");
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/install.ps1'), '-CheckOnly', '-CodexPath', fakeCLI];
  const run = () => spawnSync('powershell.exe', args, { encoding: 'utf8', windowsHide: true });
  const clean = run(); assert.equal(clean.status, 0, clean.stderr); assert.match(clean.stdout, /Preflight passed/);
  const catalogRoot = join(root, 'existing-marketplace');
  const catalogFile = join(catalogRoot, '.agents/plugins/marketplace.json');
  await mkdir(dirname(catalogFile), { recursive: true });
  const other = { name: 'preserved-plugin', source: { source: 'local', path: './plugins/preserved' } };
  await writeFile(catalogFile, JSON.stringify({ name: 'cotemu-local', plugins: [other] }));
  const listing = JSON.stringify({ marketplaces: [{ name: 'cotemu-local', root: catalogRoot }] });
  await writeFile(fakeCLI, `$command = $args -join ' '\nif ($command -eq 'plugin marketplace list --json') { '${listing.replaceAll("'", "''")}' }\nelseif ($command -ne 'plugin add --help' -and $command -notmatch '^plugin (marketplace add |add cotemu-usage-ball@cotemu-local --json$)') { throw 'Unexpected command' }\nexit 0`);
  for (let attempt = 0; attempt < 2; attempt++) {
    const installed = spawnSync('powershell.exe', args.filter(arg => arg !== '-CheckOnly'), { encoding: 'utf8', windowsHide: true });
    assert.equal(installed.status, 0, installed.stderr);
    const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
    assert.equal(catalog.plugins.length, 2); assert.deepEqual(catalog.plugins[0], other);
    assert.equal(JSON.parse(await readFile(join(catalogRoot, 'plugins/cotemu-usage-ball/plugin.json'), 'utf8')).version, '0.2.0');
  }
  await writeFile(join(root, 'dist/server.mjs'), '// corrupted fixture');
  const corrupted = run(); assert.notEqual(corrupted.status, 0); assert.match(corrupted.stderr, /integrity check failed/);
});
