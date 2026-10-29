import { INTERVAL } from './contract.js';
import { decodePublication } from './publication.js';

async function candidate(response: Response) {
  if (!response.ok) throw new Error('snapshot_unavailable');
  const text = await response.text();
  if (text.length > 32_768) throw new Error('invalid_response');
  const value = decodePublication(JSON.parse(text));
  const reference = Date.parse(response.headers.get('Date') ?? '');
  return { value, reference, response: new Response(JSON.stringify(value), {
    headers: { ...(Number.isFinite(reference) ? { Date: new Date(reference).toUTCString() } : {}) },
  }) };
}

export async function readSnapshot(primary: string | null, fetcher: typeof fetch,
  github: () => Promise<Response>, minimumPublishedAtMs = 0): Promise<Response> {
  let direct: Awaited<ReturnType<typeof candidate>> | undefined;
  if (primary) {
    try {
      direct = await candidate(await fetcher(primary, { headers: { Accept: 'application/json', 'User-Agent': 'VegetationQuota' },
        redirect: 'error', signal: AbortSignal.timeout(3_000) }));
      const { value, reference } = direct;
      const completed = value.state.lastCompletedAtMs;
      if (value.state.data && !value.state.error && value.publishedAtMs >= minimumPublishedAtMs
        && completed !== null && reference >= value.publishedAtMs - 1000
        && reference - completed <= INTERVAL + 30_000) return direct.response;
    } catch { direct = undefined; }
  }
  try {
    const fallback = await github();
    if (!direct) return fallback;
    const backup = await candidate(fallback);
    return backup.value.publishedAtMs >= direct.value.publishedAtMs ? backup.response : direct.response;
  } catch (error) {
    if (direct) return direct.response;
    throw error;
  }
}
