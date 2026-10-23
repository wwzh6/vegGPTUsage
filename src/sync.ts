import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageService } from './service.js';
import { decodePublication, publication } from './publication.js';
import { DATA_BRANCH, DATA_PATH, REPOSITORY } from './settings.js';
import type { State } from './contract.js';

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token || process.env.GITHUB_REPOSITORY !== REPOSITORY) throw new Error('configuration');
  const api = async (path: string, method = 'GET', body?: unknown, allowMissing = false): Promise<any> => {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'VegetationQuota-sync' },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error('github');
    return response.json();
  };
  const ref = await api(`/git/ref/heads/${DATA_BRANCH}`, 'GET', undefined, true);
  const existing = ref ? await api(`/contents/${DATA_PATH}?ref=${DATA_BRANCH}`) : null;
  const previous = existing ? decodePublication(JSON.parse(Buffer.from(existing.content, 'base64').toString('utf8'))) : null;
  const root = await mkdtemp(join(tmpdir(), 'vegetation-sync-'));
  try {
    const service = new UsageService(process.env.COTEMU_API_KEY, root);
    if (previous) await service.store.locked(() => service.store.write(previous.state));
    const usage = await service.get(process.env.VEGETATION_MANUAL_REFRESH === 'true');
    const { state: _mode, queried: _queried, stale: _stale, returnedAtMs: _returned, ...query } = usage.query;
    const state: State = { ...query, data: usage.data };
    const content = JSON.stringify(publication(state, Date.now())) + '\n';
    const blob = await api('/git/blobs', 'POST', { content, encoding: 'utf-8' });
    const parent = ref ? await api(`/git/commits/${ref.object.sha}`) : null;
    const tree = await api('/git/trees', 'POST', { ...(parent ? { base_tree: parent.tree.sha } : {}),
      tree: [{ path: DATA_PATH, mode: '100644', type: 'blob', sha: blob.sha }] });
    const commit = await api('/git/commits', 'POST', { message: 'Update shared usage snapshot', tree: tree.sha,
      parents: ref ? [ref.object.sha] : [] });
    if (ref) await api(`/git/refs/heads/${DATA_BRANCH}`, 'PATCH', { sha: commit.sha, force: false });
    else await api('/git/refs', 'POST', { ref: `refs/heads/${DATA_BRANCH}`, sha: commit.sha });
    console.log(JSON.stringify({ published: true, queried: usage.query.queried, state: state.error ?? 'ok' }));
  } finally { await rm(root, { recursive: true, force: true }); }
}
main().catch(() => { console.error('Shared usage synchronization failed; no raw API response was logged.'); process.exitCode = 1; });
