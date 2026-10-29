import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodePublication } from './publication.js';

export function snapshotServer(directory: string) {
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.url !== '/vegetation-quota/usage.json') { response.writeHead(404).end(); return; }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return;
    }
    try {
      const bytes = await readFile(join(directory, 'usage.json'));
      if (bytes.length > 32_768) throw new Error('invalid_response');
      const { publisherLease: _lease, ...value } = decodePublication(JSON.parse(bytes.toString('utf8')));
      const body = JSON.stringify(value) + '\n';
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch { response.writeHead(503).end(); }
  });
}
