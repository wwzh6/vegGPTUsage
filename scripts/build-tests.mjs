import { build } from 'esbuild';
await build({ entryPoints: ['src/service.ts', 'src/contract.ts', 'src/ui/controller.ts'], bundle: true,
  platform: 'node', target: 'node22', format: 'esm', outdir: 'artifacts/test', outbase: 'src', outExtension: { '.js': '.mjs' } });
