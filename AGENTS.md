# AI installation workflow

This repository contains 植被组额度查询, a local Codex MCP App. Follow
`docs/AI-INSTALL.md` to install the checked-in prebuilt runtime on Windows.
Members need GitHub repository read access, Node.js >=22.19, and Git. They do not
need an account API key, npm, Python, or build dependencies.

Never request credentials in chat, print them, commit them, or distribute the
account key to clients. Only the administrator uses `docs/ADMIN-SETUP.md` to
configure the shared account key in GitHub Actions Secrets. Do not inspect
unrelated credentials or change model/provider settings or repository visibility.

The client reads sanitized snapshots from the private quota-data branch. A click
reads the latest snapshot; it does not query the upstream API or trigger Actions.
Scheduled GitHub synchronization may be delayed. Preserve stale/unknown states.

For development: `npm ci --ignore-scripts`, `npm run check`, `npm run build`,
`npm test`. Commit `dist/` and `runtime.sha256.json` together. Update only the root
package versions in the lockfile; never replace dependency version strings.
Preserve the internal plugin ID. UI contains only the ring and two text lines.
