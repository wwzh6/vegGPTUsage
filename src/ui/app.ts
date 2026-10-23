import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { UsageController } from './controller.js';
import type { UsageResult } from '../contract.js';
import '@openai/mcp-extensions/app/styles.css';

const app = new App({ name: '植被组额度查询', version: '0.2.0' });
const controller = new UsageController(document, {
  query: async refresh => {
    const response = await app.callServerTool({ name: 'get_usage', arguments: { refresh } });
    if (response.isError || !response.structuredContent) throw new Error('unavailable');
    return response.structuredContent as unknown as UsageResult;
  },
  close: () => app.requestTeardown(),
});
const visibilityObserver = new IntersectionObserver(entries => {
  controller.setOccluded(!entries.some(entry => entry.isIntersecting));
});
visibilityObserver.observe(document.documentElement);

function applyContext(context: ReturnType<App['getHostContext']>) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context?.safeAreaInsets) for (const [edge, pixels] of Object.entries(context.safeAreaInsets))
    document.documentElement.style.setProperty(`--safe-${edge}`, `${pixels}px`);
}
app.ontoolresult = response => {
  if (!response.structuredContent) controller.failBridge();
  else controller.accept(response.structuredContent as unknown as UsageResult);
};
app.ontoolcancelled = () => controller.failBridge();
app.onhostcontextchanged = () => applyContext(app.getHostContext());
app.onteardown = async () => { visibilityObserver.disconnect(); controller.destroy(); return {}; };
try {
  await app.connect();
  applyContext(app.getHostContext());
  const version = app.getHostVersion()?.version?.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (app.getHostContext()?.platform === 'desktop' && version && Number(version[1]) >= 20 && Number(version[1]) < 100) {
    const parts = version.slice(1).map(Number);
    const minimum = [26, 928, 20710];
    const difference = parts.findIndex((part, index) => part !== minimum[index]);
    if (difference >= 0 && parts[difference] < minimum[difference]) {
      controller.destroy();
      document.getElementById('countdown')!.textContent = '请更新客户端';
      document.querySelector<HTMLButtonElement>('#ball')!.disabled = true;
    }
  }
} catch { controller.failBridge(); }
