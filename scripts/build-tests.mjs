import { build } from 'esbuild';
await build({ entryPoints: ['src/service.ts', 'src/shared-service.ts', 'src/publication.ts', 'src/git-publication.ts', 'src/publisher-policy.ts', 'src/contract.ts', 'src/notices.ts', 'src/ui/controller.ts'], bundle: true,
  platform: 'node', target: 'node22', format: 'esm', outdir: 'artifacts/test', outbase: 'src', outExtension: { '.js': '.mjs' },
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
