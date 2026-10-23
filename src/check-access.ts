import { githubCredential, githubFetch, REPOSITORY } from './github.js';
async function main() {
  const token = await githubCredential();
  if (!token) throw new Error('authentication');
  const response = await githubFetch(`https://api.github.com/repos/${REPOSITORY}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'VegetationQuota' },
    signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!response.ok) throw new Error('access');
  console.log(JSON.stringify({ githubReadAccess: true, accountApiKeyRequired: false }));
}
main().catch(() => { console.error('GitHub access unavailable. Sign in with an account that can read wwzh6/vegGPTUsage.'); process.exitCode = 1; });
