import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const repository = 'wwzh6/vegGPTUsage';
try {
  const token = process.env.GITHUB_TOKEN;
  if ((!token && process.env.VEGETATION_PUBLISH_TRANSPORT !== 'git') || !process.env.COTEMU_API_KEY?.trim())
    throw new Error('configuration');
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'VegetationQuota-server' };
  const hashes = JSON.parse(await readFile(new URL('../runtime.sha256.json', import.meta.url), 'utf8'));
  const runtime = new URL('../dist/sync.mjs', import.meta.url);
  if (createHash('sha256').update(await readFile(runtime)).digest('hex') !== hashes['dist/sync.mjs'])
    throw new Error('runtime_integrity');
  const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/sync-usage.yml`, {
    headers,
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('workflow_check');
  if ((await response.json()).state !== 'disabled_manually') throw new Error('workflow_still_active');
  const runs = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/sync-usage.yml/runs?per_page=10`, {
    headers,
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!runs.ok) throw new Error('workflow_check');
  const history = await runs.json();
  if (!Array.isArray(history.workflow_runs) || history.workflow_runs.some(run => run.status !== 'completed'))
    throw new Error('workflow_busy');
  process.env.GITHUB_REPOSITORY = repository;
  process.env.VEGETATION_SCHEDULED_REFRESH = 'true';
  process.env.VEGETATION_FAIL_ON_QUERY_ERROR = 'true';
  await import(runtime.href);
} catch (error) {
  const known = ['configuration', 'runtime_integrity', 'workflow_check', 'workflow_still_active', 'workflow_busy'];
  console.error(JSON.stringify({ published: false, error: known.includes(error.message) ? error.message : 'server_sync_failed' }));
  process.exitCode = 1;
}
