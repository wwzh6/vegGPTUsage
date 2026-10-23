import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { UsageService } from '../artifacts/test/service.mjs';
import { reply } from './fixture.mjs';

async function temp(t) {
  const root = await mkdtemp(join(tmpdir(), 'cotemu-integration-'));
  t.after(() => rm(root, { recursive: true, force: true })); return root;
}
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { windowsHide: true });
    let out = ''; let err = '';
    child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
  });
}

test('separate Node processes share a single upstream request and cache', async t => {
  const root = await temp(t); const log = join(root, 'requests.txt');
  const outputs = await Promise.all(Array.from({ length: 5 }, () => run(['tests/process-worker.mjs', root, log])));
  assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 1);
  assert.ok(outputs.every(output => output.data.usedPercent === 40));
});

test('a lock left by a dead owner is recovered', async t => {
  const root = await temp(t);
  const service = new UsageService('synthetic-dead-owner-key', root, async () => reply());
  const lock = join(service.store.directory, 'lock');
  await mkdir(lock, { recursive: true }); await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: 2147483647 }));
  assert.equal((await service.get(true)).data.usedPercent, 40);
});

test('prebuilt stdio server initializes, discovers both tools, opens resource, and handles missing key', async t => {
  const root = await temp(t);
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/server.mjs')],
    env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, LOCALAPPDATA: root, COTEMU_API_KEY: '' }, stderr: 'pipe' });
  const client = new Client({ name: 'cotemu-acceptance', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_usage', 'open_usage_ball']);
  const tool = tools.find(tool => tool.name === 'open_usage_ball');
  assert.equal(tool._meta['openai/ui'].entrypoints[0].type, 'thread');
  const value = await client.callTool({ name: 'open_usage_ball', arguments: {} });
  assert.equal(value.structuredContent.query.error, 'missing_key');
  const resource = await client.readResource({ uri: tool._meta.ui.resourceUri });
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(resource.contents[0].text, /植被组额度查询/);
  assert.ok(!resource.contents[0].text.includes('BUNDLED_SCRIPT'));
  const invalid = await client.callTool({ name: 'get_usage', arguments: { refresh: 'yes' } });
  assert.equal(invalid.isError, true);
});
