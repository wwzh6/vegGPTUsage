import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { normalize, result, emptyState } from '../artifacts/test/contract.mjs';
import { body } from '../tests/fixture.mjs';

const sample = result({ ...emptyState(), data: normalize(body(), Date.now()), lastAttemptAtMs: Date.now() - 16000,
  lastCompletedAtMs: Date.now(), nextAllowedAtMs: Date.now(), nextRefreshAtMs: Date.now() + 600_000 }, Date.now());
const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Vegetation quota preview · synthetic data</title>
<style>body{margin:0;background:#e6ebe5;font:14px system-ui;color:#264238}header{padding:18px}iframe{border:1px solid #d5ded3;border-radius:12px;width:340px;height:240px;background:#f8faf7}main{display:flex;justify-content:center;padding:15px}</style>
<header>模拟数据预览 · 不连接真实账号 <span id="audit">查询 0 次；关闭请求 0 次</span>
<label>主题 <select id="theme"><option value="light">浅色</option><option value="dark">深色</option></select></label>
<label>宽度 <select id="width"><option value="340">340</option><option value="240">240</option></select></label></header>
<main><iframe id="app" title="植被组额度查询" src="/app"></iframe></main>
<script>
const sample=${JSON.stringify(sample)};let queries=0,closes=0;const frame=document.getElementById('app');
function send(data){frame.contentWindow.postMessage({jsonrpc:'2.0',...data},location.origin)}
function audit(){document.getElementById('audit').textContent='查询 '+queries+' 次；关闭请求 '+closes+' 次'}
document.getElementById('theme').onchange=e=>send({method:'ui/notifications/host-context-changed',params:{theme:e.target.value}});
document.getElementById('width').onchange=e=>frame.style.width=e.target.value+'px';
addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.origin!==location.origin)return;const m=e.data;
 if(m.method==='ui/initialize')send({id:m.id,result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'synthetic-preview',version:'1.0.0'},hostCapabilities:{serverTools:{}},hostContext:{theme:'light',platform:'web',displayMode:'fullscreen'}}});
 else if(m.method==='ui/notifications/initialized')send({method:'ui/notifications/tool-result',params:{content:[],structuredContent:sample}});
 else if(m.method==='tools/call'){queries++;audit();sample.query.returnedAtMs=Date.now();sample.query.nextAllowedAtMs=Date.now()+15000;sample.query.nextRefreshAtMs=Date.now()+600000;sample.query.queried=true;send({id:m.id,result:{content:[],structuredContent:sample}})}
 else if(m.method==='ui/notifications/request-teardown'){closes++;audit()}
 else if(m.id!=null)send({id:m.id,result:{}});
});
</script></html>`;
createServer(async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url === '/app') res.end(await readFile(new URL('../dist/usage-ball.html', import.meta.url)));
  else if (req.url === '/') res.end(page);
  else { res.writeHead(404); res.end('Not found'); }
}).listen(18764, '127.0.0.1', () => console.log('Synthetic preview: http://127.0.0.1:18764'));
