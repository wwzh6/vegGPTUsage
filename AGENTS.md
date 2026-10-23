# AI installation workflow

This repository contains 植被组额度查询, a local Codex MCP App. Follow
`docs/AI-INSTALL.md` when asked to install it. Use the checked-in prebuilt runtime;
installation needs no npm dependencies or build. Supported installer: Windows.

Never request API keys in chat, print them, copy them to files, or commit them.
Use the local masked dialog in `scripts/configure-key.ps1`. The key is an account
API key, not a team code or team token. Report configuration and live verification
separately. Do not read unrelated credentials or change model/provider settings.

For development: `npm ci --ignore-scripts`, `npm run check`, `npm run build`,
`npm test`. Commit `dist/` and `runtime.sha256.json` together after a successful
build. Preserve the internal plugin ID for upgrades. UI copy uses 植被组额度查询.
The normal UI contains only the ring and two text lines.
