import { execFile } from 'node:child_process';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

import { REPOSITORY, PRIMARY_SNAPSHOT_URL } from './settings.js';
export { REPOSITORY, SNAPSHOT_URL } from './settings.js';

function run(file: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' } },
    (error, stdout) => error ? reject(new Error('shared_auth_required')) : resolve(stdout));
    if (input) child.stdin?.end(input);
  });
}

export async function githubCredential(): Promise<string | null> {
  try {
    const output = await run('git', ['-c', 'credential.interactive=never', 'credential', 'fill'],
      `protocol=https\nhost=github.com\npath=${REPOSITORY}.git\n\n`);
    const token = output.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9).trim();
    if (token) return token;
  } catch {}
  try { return (await run('gh', ['auth', 'token', '--hostname', 'github.com'])).trim() || null; }
  catch { return null; }
}

async function proxyAddress(): Promise<string | undefined> {
  if (process.env.VEGETATION_HTTPS_PROXY) return process.env.VEGETATION_HTTPS_PROXY;
  if (process.platform === 'win32') {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    try {
      if (/REG_DWORD\s+0x1\b/.test(await run('reg', ['query', key, '/v', 'ProxyEnable']))) {
        const raw = (await run('reg', ['query', key, '/v', 'ProxyServer'])).match(/REG_SZ\s+([^\r\n]+)/)?.[1].trim();
        const selected = raw?.includes('=') ? raw.split(';').find(part => part.startsWith('https='))?.slice(6) : raw;
        if (selected) return selected.includes('://') ? selected : `http://${selected}`;
      }
    } catch {}
  }
  return process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
}

let dispatcher: Promise<ProxyAgent | undefined> | undefined;
export const githubFetch: typeof fetch = async (input, init) => {
  if (String(input) === PRIMARY_SNAPSHOT_URL)
    return await undiciFetch(input as string, init as Parameters<typeof undiciFetch>[1]) as unknown as Response;
  dispatcher ??= proxyAddress().then(address => address ? new ProxyAgent(address) : undefined);
  const agent = await dispatcher;
  return await undiciFetch(input as Parameters<typeof undiciFetch>[0],
    { ...init, ...(agent ? { dispatcher: agent } : {}) } as Parameters<typeof undiciFetch>[1]) as unknown as Response;
};
