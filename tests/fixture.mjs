export const NOW = 1_791_115_200_000;
export function account(overrides = {}) {
  return { id: 23, name: 'REDACTED-ACCOUNT-NAME', platform: 'openai', bound: true, status: 'available',
    updated_at_ms: NOW - 60_000, resume_at_ms: NOW + 999_000,
    seven_day: { used_percent: 40, resets_at_ms: NOW + 3 * 86400_000, enforced: true }, ...overrides };
}
export const body = (accounts = [account()]) => ({ server_ms: NOW, accounts });
export const reply = (data = body(), status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});
