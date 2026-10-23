import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
await mkdir('dist', { recursive: true });
const server = await build({ entryPoints: ['src/server.ts'], bundle: true, platform: 'node', target: 'node22', format: 'esm', outfile: 'dist/server.mjs', metafile: true,
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
const helpers = await build({ entryPoints: ['src/sync.ts', 'src/check-access.ts'], bundle: true, platform: 'node', target: 'node22', format: 'esm', outdir: 'dist', outExtension: { '.js': '.mjs' }, metafile: true,
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
const app = await build({ entryPoints: ['src/ui/app.ts'], bundle: true, platform: 'browser', target: 'es2022',
  format: 'esm', outfile: 'app.js', write: false, minify: true, metafile: true });
let html = await readFile('src/ui/index.html', 'utf8');
html = html.replace('<!-- BUNDLED_SCRIPT -->', () => `<script type="module">${app.outputFiles.find(f => f.path.endsWith('.js')).text.replaceAll('</script', '<\\/script')}</script>`)
  .replace('<!-- BUNDLED_STYLE -->', () => `<style>${app.outputFiles.find(f => f.path.endsWith('.css'))?.text ?? ''}</style>`);
await writeFile('dist/usage-ball.html', html);
const packages = new Map();
for (const file of [...Object.keys(server.metafile.inputs), ...Object.keys(app.metafile.inputs), ...Object.keys(helpers.metafile.inputs)]) {
  if (!file.includes('node_modules/')) continue;
  let dir = dirname(file);
  while (dir !== '.' && dir.includes('node_modules')) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      if (pkg.name) { packages.set(dir, pkg); break; }
    } catch {}
    dir = dirname(dir);
  }
}
const notices = ['# Bundled third-party software\n'];
for (const [dir, pkg] of packages) {
  notices.push(`## ${pkg.name} ${pkg.version}\nLicense: ${pkg.license ?? 'See package license'}\n`);
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING']) {
    try { notices.push(await readFile(join(dir, name), 'utf8')); break; } catch {}
  }
}
await writeFile('THIRD_PARTY_NOTICES.md', notices.join('\n'));
const hashes = {};
const files = ['plugin.json', 'mcp.json', '.mcp.json', '.codex-plugin/plugin.json'];
for (const folder of ['dist', 'assets', 'skills']) {
  for (const file of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (file.isFile()) files.push(join(file.parentPath, file.name).replaceAll('\\', '/'));
  }
}
for (const file of files.sort()) hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
await writeFile('runtime.sha256.json', JSON.stringify(hashes, null, 2) + '\n');
console.log('Built self-contained server and MCP App.');
