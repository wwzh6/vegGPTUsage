import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const binary = process.argv[2];
if (!binary) throw new Error('Pass the local codex executable path.');
let catalogPath = process.argv[3];
if (!catalogPath) {
  const listing = spawnSync(binary, ['plugin', 'marketplace', 'list', '--json'], { encoding: 'utf8', windowsHide: true });
  if (listing.status !== 0) throw new Error('Unable to inspect installed marketplaces.');
  const marketplace = JSON.parse(listing.stdout).marketplaces.find(item => item.name === 'cotemu-local');
  if (!marketplace) throw new Error('The quota marketplace is not installed.');
  catalogPath = resolve(marketplace.root, '.agents/plugins/marketplace.json');
}
const catalog = resolve(catalogPath);
await mkdir('artifacts', { recursive: true });
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
  await call('initialize', { clientInfo: { name: 'cotemu-install-check', version: '0.3.2' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const plugin = await call('plugin/read', { marketplacePath: catalog, pluginName: 'cotemu-usage-ball' });
  console.log(JSON.stringify(plugin, null, 2));
  await writeFile('artifacts/installed-plugin.json', JSON.stringify(plugin, null, 2));
  const detail = plugin.plugin ?? plugin;
  const name = detail.mcpServers?.[0];
  if (!name) throw new Error('The plugin MCP server was not discovered.');
  if (name) {
    const status = await call('mcpServerStatus/list', { serverName: name, detail: 'full' });
    console.log(JSON.stringify(status, null, 2));
    await writeFile('artifacts/installed-mcp-status.json', JSON.stringify(status, null, 2));
    const entry = status.data?.find(item => item.name === name);
    if (!entry || entry.toolsError || !entry.tools?.get_usage || !entry.tools?.open_usage_ball)
      throw new Error('Quota tools failed discovery.');
    for (const type of ['global', 'thread']) {
      if (!entry.tools.open_usage_ball._meta?.['openai/ui']?.entrypoints?.some(item => item.type === type))
        throw new Error(`The ${type} entrypoint was not discovered.`);
    }
  }
} finally { child.stdin.end(); child.kill(); }
