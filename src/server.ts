import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { OpenAIUiToolMetadata } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { UsageService } from './service.js';
import { messages, type UsageResult } from './contract.js';

const server = new McpServer({ name: 'cotemu-usage-ball', version: '0.2.2' });
const uri = 'ui://cotemu-usage-ball/v1';
const cache = join(process.env.LOCALAPPDATA || join(homedir(), '.cache'), 'cotemu-usage-ball', 'cache');
const service = new UsageService(process.env.COTEMU_API_KEY, cache);
const html = await readFile(new URL('./usage-ball.html', import.meta.url), 'utf8');

function toolResult(value: UsageResult) {
  const summary = value.query.error ? messages[value.query.error]
    : `植被组额度查询：${value.data?.usedPercent == null ? '未知' : `${value.data.usedPercent}%`}。账号共享数据，不代表个人花费。`;
  return { content: [{ type: 'text' as const, text: summary }], structuredContent: { ...value } };
}

registerAppResource(server, 'usage-ball', uri, {}, async () => ({ contents: [{
  uri, mimeType: RESOURCE_MIME_TYPE, text: html,
  _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } },
    'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['fullscreen', 'inline'] } },
}] }));

registerAppTool(server, 'open_usage_ball', {
  title: '植被组额度查询', description: 'Open the bound Cotemu OpenAI account seven-day usage ring in the conversation panel. Account-wide data, not personal spend.',
  inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  _meta: { ui: { resourceUri: uri }, 'openai/ui': { entrypoints: [{ type: 'thread' }] } satisfies OpenAIUiToolMetadata },
}, async () => toolResult(await service.get(true)));

server.registerTool('get_usage', {
  description: 'Read sanitized bound-account usage. refresh=true requests a manual refresh, subject to shared cooldown.',
  inputSchema: { refresh: z.boolean().optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  _meta: { ui: { visibility: ['app', 'model'] } },
}, async ({ refresh }) => toolResult(await service.get(refresh ?? false)));

await server.connect(new StdioServerTransport());
