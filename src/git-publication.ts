import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { decodePublication } from './publication.js';
import { DATA_BRANCH, DATA_PATH } from './settings.js';

export class GitPublicationStore {
  private parent = '';
  constructor(private readonly root: string,
    private readonly remote = 'ssh://git@ssh.github.com:443/wwzh6/vegGPTUsage.git') {}
  private git(args: string[], input?: string): Promise<string> {
    const { COTEMU_API_KEY: _key, GITHUB_TOKEN: _token, ...env } = process.env;
    return new Promise((resolve, reject) => {
      const child = execFile('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
        cwd: this.root, env: { ...env, GIT_TERMINAL_PROMPT: '0',
          GIT_AUTHOR_NAME: 'Vegetation Quota', GIT_AUTHOR_EMAIL: 'quota@localhost',
          GIT_COMMITTER_NAME: 'Vegetation Quota', GIT_COMMITTER_EMAIL: 'quota@localhost' },
        timeout: 30_000, maxBuffer: 256 * 1024, windowsHide: true,
      }, (error, stdout) => error ? reject(new Error('git_publication_failed')) : resolve(stdout.trim()));
      child.stdin?.end(input);
    });
  }
  async read() {
    await mkdir(this.root, { recursive: true });
    await this.git(['init', '--bare', '--quiet']);
    await this.git(['remote', 'add', 'origin', this.remote]);
    await this.git(['fetch', '--quiet', '--depth=1', '--no-tags', 'origin', DATA_BRANCH]);
    this.parent = await this.git(['rev-parse', 'FETCH_HEAD']);
    return decodePublication(JSON.parse(await this.git(['show', `${this.parent}:${DATA_PATH}`])));
  }
  async publish(content: string) {
    if (!this.parent) throw new Error('git_parent_missing');
    decodePublication(JSON.parse(content));
    await this.git(['read-tree', this.parent]);
    const blob = await this.git(['hash-object', '-w', '--stdin'], content);
    await this.git(['update-index', '--add', '--cacheinfo', `100644,${blob},${DATA_PATH}`]);
    const tree = await this.git(['write-tree']);
    const commit = await this.git(['commit-tree', tree, '-p', this.parent, '-m', 'Update shared usage snapshot']);
    await this.git(['push', '--quiet', 'origin', `${commit}:refs/heads/${DATA_BRANCH}`]);
    this.parent = commit;
  }
}
