import { snapshotServer } from './snapshot-server.js';

const host = process.env.VEGETATION_HTTP_HOST ?? '127.0.0.1';
const port = Number(process.env.VEGETATION_HTTP_PORT ?? 9817);
const directory = process.env.VEGETATION_PUBLIC_DIRECTORY ?? '/var/cache/vegetation-quota-public';
const server = snapshotServer(directory);
server.on('error', () => { console.error('Snapshot listener unavailable.'); process.exitCode = 1; });
server.listen(port, host);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close());
