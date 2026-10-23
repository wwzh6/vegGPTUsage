import { INTERVAL, messages, type UsageResult } from '../contract.js';

export interface Bridge {
  query(refresh: boolean): Promise<UsageResult>;
  close(): Promise<void>;
}

export function view(result: UsageResult, elapsed: number) {
  const data = result.data;
  const serverNow = result.serverNowMs === null ? null : result.serverNowMs + Math.max(0, elapsed);
  const age = data?.updatedAtMs != null && serverNow !== null ? serverNow - data.updatedAtMs : null;
  const remaining = data?.resetsAtMs != null && serverNow !== null ? data.resetsAtMs - serverNow : null;
  let countdown = '时间未知';
  if (remaining !== null) {
    if (remaining <= 0) countdown = '已到重置时间，待更新';
    else {
      const minutes = Math.ceil(remaining / 60_000);
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor(minutes % 1440 / 60);
      countdown = days ? `${days}天 ${hours}小时` : hours ? `${hours}小时 ${minutes % 60}分` : `${minutes}分钟`;
    }
  }
  const flags = [];
  if (result.query.stale) flags.push('旧数据');
  if (data && (age === null || age < 0)) flags.push('新鲜度未知');
  else if (age !== null && age > INTERVAL) flags.push('可能过时');
  if (data?.enforced === false) flags.push('仅供参考');
  if (data && data.enforced === null) flags.push('限制状态未知');
  const statuses = { available: '账号可用', tripped: '账号已熔断', offline: '账号暂时离线',
    paused: '账号已暂停', unavailable: '账号异常', unknown: '账号状态未知' };
  return {
    percent: data?.usedPercent == null ? '用量未知' : `${Number(data.usedPercent.toFixed(1))}%`,
    used: data?.usedPercent ?? null, countdown, flags,
    status: data ? statuses[data.accountStatus] : '等待账号数据',
    error: result.query.error ? messages[result.query.error] ?? '查询失败' : '',
    updated: age !== null && age >= 0 ? `账号数据 ${Math.floor(age / 60_000)} 分钟前更新` : '',
  };
}

export class UsageController {
  private data: UsageResult | null = null;
  private receivedAt = 0;
  private due = 0;
  private allowed = 0;
  private busy = false;
  private closed = false;
  private hidden = false;
  private occluded = false;
  private destroyed = false;
  private bridgeError = false;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private tickTimer?: ReturnType<typeof setInterval>;
  private readonly ball: HTMLButtonElement;
  private readonly visibility = () => this.setHidden(this.document.hidden);
  private readonly pageHide = () => this.setHidden(true);
  private readonly pageShow = () => this.setHidden(this.document.hidden);

  constructor(private readonly document: Document, private readonly bridge: Bridge,
    private readonly clock = { now: () => Date.now(), mono: () => performance.now() }) {
    this.ball = this.document.querySelector<HTMLButtonElement>('#ball')!;
    this.ball.onclick = () => { void (this.closed ? this.reopen() : this.refresh(true)); };
    this.ball.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); void this.close(); } };
    document.addEventListener('visibilitychange', this.visibility);
    document.addEventListener('freeze', this.pageHide);
    document.addEventListener('resume', this.pageShow);
    document.defaultView?.addEventListener('pagehide', this.pageHide);
    document.defaultView?.addEventListener('pageshow', this.pageShow);
    this.hidden = document.hidden;
  }
  accept(value: UsageResult) {
    if (this.destroyed) return;
    if (value?.version !== 1 || !value.query) { this.failBridge(); return; }
    this.data = value;
    this.receivedAt = this.clock.mono();
    this.due = this.clock.now() + Math.max(0, value.query.nextRefreshAtMs - value.query.returnedAtMs);
    this.allowed = this.clock.now() + Math.max(0, value.query.nextAllowedAtMs - value.query.returnedAtMs);
    this.bridgeError = false;
    this.render();
    this.schedule();
  }
  failBridge() {
    this.bridgeError = true;
    this.due = this.clock.now() + INTERVAL;
    this.render();
    this.schedule();
  }
  private text(id: string, text: string) { this.document.getElementById(id)!.textContent = text; }
  private render() {
    if (this.destroyed || this.closed) return;
    this.ball.disabled = this.busy;
    this.ball.setAttribute('aria-busy', String(this.busy));
    if (!this.data) {
      if (this.bridgeError) this.text('countdown', '连接失败，点击重试');
      return;
    }
    const display = view(this.data, this.clock.mono() - this.receivedAt);
    this.text('percent', display.percent);
    const flags = this.bridgeError && !display.flags.includes('旧数据') && this.data.data
      ? ['旧数据', ...display.flags] : display.flags;
    this.document.querySelector<SVGCircleElement>('#used-ring')!.style.strokeDasharray = `${display.used ?? 0} 100`;
    this.ball.dataset.unknown = String(display.used === null);
    const stale = flags.includes('旧数据') || flags.includes('可能过时');
    let line = display.countdown === '已到重置时间，待更新' ? '已到期，待更新' : display.countdown;
    if (stale) line = `旧 · ${line}`;
    else if (flags.includes('仅供参考')) line = `参考 · ${line}`;
    if (this.data.query.error === 'rate_limited' && this.clock.now() < this.allowed)
      line = `冷却 ${Math.ceil((this.allowed - this.clock.now()) / 1000)}秒`;
    else if (this.data.query.autoPaused) line = this.data.query.error === 'missing_key' ? '未配置密钥' : this.data.query.error ? '连接异常' : line;
    else if (!this.data.data && (display.error || this.bridgeError)) line = '查询失败，点击重试';
    if (this.busy) line = '正在查询…';
    this.text('countdown', line);
    this.ball.dataset.warning = String(stale || !!display.error || this.bridgeError || flags.length > 0);
    this.ball.title = ['植被组额度查询', `已用 ${display.percent}，重置：${display.countdown}`, display.status,
      flags.join(' · '), display.updated, display.error, this.bridgeError ? '无法连接用量服务' : '',
      '点击刷新；每10分钟自动更新；使用面板关闭按钮或聚焦后按 Esc 关闭。',
      '绑定账号共享七天用量，不代表个人花费、账单余额或实际可调用余量。'].filter(Boolean).join('\n');
    this.ball.setAttribute('aria-label', this.ball.title);
  }
  private stopTimers() {
    clearTimeout(this.refreshTimer); clearInterval(this.tickTimer);
    this.refreshTimer = undefined; this.tickTimer = undefined;
  }
  private schedule() {
    this.stopTimers();
    if (this.destroyed || this.closed || this.hidden || (!this.data && !this.bridgeError)) return;
    this.tickTimer = setInterval(() => this.render(), 1000);
    if (this.busy || this.data?.query.autoPaused) return;
    const delay = Math.max(0, Math.max(this.due, this.allowed) - this.clock.now());
    this.refreshTimer = setTimeout(() => { void this.refresh(false); }, Math.min(delay, 2_147_483_647));
  }
  async refresh(manual: boolean) {
    if (this.destroyed || this.closed || this.hidden || this.busy) return;
    if (!manual && this.data?.query.autoPaused) return;
    if (this.clock.now() < this.allowed) {
      this.text('countdown', this.data?.query.error === 'rate_limited' ? '仍在冷却' : '刚刚查询');
      return;
    }
    if (!manual && this.clock.now() < this.due) { this.schedule(); return; }
    this.busy = true;
    this.stopTimers();
    this.render();
    try { this.accept(await this.bridge.query(manual)); }
    catch { this.failBridge(); }
    finally { this.busy = false; this.render(); this.schedule(); }
  }
  setHidden(hidden: boolean) {
    hidden = hidden || this.occluded;
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    if (hidden) this.stopTimers();
    else { this.render(); this.schedule(); }
  }
  setOccluded(occluded: boolean) {
    this.occluded = occluded;
    this.setHidden(this.document.hidden);
  }
  async close() {
    this.closed = true;
    this.stopTimers();
    this.ball.disabled = false;
    this.ball.dataset.unknown = 'true';
    this.text('percent', '已关闭');
    this.text('countdown', '点击重开');
    this.ball.setAttribute('aria-label', '已关闭，点击重开');
    try { await this.bridge.close(); } catch { /* The stopped view remains usable when the host keeps the panel open. */ }
  }
  async reopen() {
    if (this.destroyed) return;
    this.closed = false;
    this.render();
    await this.refresh(true);
    this.schedule();
  }
  destroy() {
    this.destroyed = true;
    this.stopTimers();
    this.document.removeEventListener('visibilitychange', this.visibility);
    this.document.removeEventListener('freeze', this.pageHide);
    this.document.removeEventListener('resume', this.pageShow);
    this.document.defaultView?.removeEventListener('pagehide', this.pageHide);
    this.document.defaultView?.removeEventListener('pageshow', this.pageShow);
  }
}
