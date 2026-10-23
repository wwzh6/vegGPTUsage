import { appendFile } from 'node:fs/promises';
import { UsageService } from '../artifacts/test/service.mjs';
import { reply } from './fixture.mjs';
const [root, log] = process.argv.slice(2);
const service = new UsageService('synthetic-process-test-key', root, async () => {
  await appendFile(log, 'request\n');
  await new Promise(resolve => setTimeout(resolve, 150));
  return reply();
});
console.log(JSON.stringify(await service.get(true)));
