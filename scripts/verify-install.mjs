import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const binary = process.argv[2];
const catalog = resolve(process.argv[3] ?? 'artifacts/local-marketplace/.agents/plugins/marketplace.json');
if (!binary) throw new Error('Pass the local codex executable path.');
const child = spawn(binary, ['app-server', '--stdio'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
const pending = new Map(); let sequence = 0;
createInterface({ input: child.stdout }).on('line', line => {
  try { const message = JSON.parse(line); if (message.id != null) pending.get(message.id)?.(message); } catch {}
});
function call(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 25_000);
    pending.set(id, message => { clearTimeout(timer); pending.delete(id); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result); });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
try {
  await call('initialize', { clientInfo: { name: 'cotemu-install-check', version: '0.2.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const plugin = await call('plugin/read', { marketplacePath: catalog, pluginName: 'cotemu-usage-ball' });
  console.log(JSON.stringify(plugin, null, 2));
  await writeFile('artifacts/installed-plugin.json', JSON.stringify(plugin, null, 2));
  const detail = plugin.plugin ?? plugin;
  const name = detail.mcpServers?.[0];
  if (name) {
    const status = await call('mcpServerStatus/list', { serverName: name, detail: 'full' });
    console.log(JSON.stringify(status, null, 2));
    await writeFile('artifacts/installed-mcp-status.json', JSON.stringify(status, null, 2));
  }
} finally { child.stdin.end(); child.kill(); }
