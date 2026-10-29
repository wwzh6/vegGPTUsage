import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const repository = 'wwzh6/vegGPTUsage';
try {
  const token = process.env.GITHUB_TOKEN;
  if ((!token && process.env.VEGETATION_PUBLISH_TRANSPORT !== 'git') || !process.env.COTEMU_API_KEY?.trim())
    throw new Error('configuration');
  const hashes = JSON.parse(await readFile(new URL('../runtime.sha256.json', import.meta.url), 'utf8'));
  const runtime = new URL('../dist/sync.mjs', import.meta.url);
  if (createHash('sha256').update(await readFile(runtime)).digest('hex') !== hashes['dist/sync.mjs'])
    throw new Error('runtime_integrity');
  process.env.GITHUB_REPOSITORY = repository;
  process.env.VEGETATION_SCHEDULED_REFRESH = 'true';
  process.env.VEGETATION_FAIL_ON_QUERY_ERROR = 'true';
  await import(runtime.href);
} catch (error) {
  const known = ['configuration', 'runtime_integrity'];
  console.error(JSON.stringify({ published: false, error: known.includes(error.message) ? error.message : 'server_sync_failed' }));
  process.exitCode = 1;
}
