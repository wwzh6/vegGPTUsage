# AI installation workflow

This repository contains 植被组额度查询, a local Codex MCP App. Follow
`docs/AI-INSTALL.md` to install the checked-in prebuilt runtime on Windows.
Members need Node.js >=22.19 and Git. Private repositories require GitHub read access; public repositories support anonymous reads. They do not
need an account API key, npm, Python, or build dependencies.

Never request credentials in chat, print them, commit them, or distribute the
account key to clients. Only the administrator provisions central synchronization
using `docs/SERVER-SYNC.md` or the GitHub fallback in `docs/ADMIN-SETUP.md`. Do not inspect
unrelated credentials or change model/provider settings or repository visibility.

The client reads sanitized snapshots from quota-data and text cards from main/NOTICE.md. A click
reads the latest snapshot; it does not query the upstream API or trigger Actions.
Scheduled GitHub synchronization may be delayed. Preserve stale/unknown states.

For development: `npm ci --ignore-scripts`, `npm run check`, `npm run build`,
`npm test`. Commit `dist/` and `runtime.sha256.json` together. Update only the root
package versions in the lockfile; never replace dependency version strings.
Preserve the internal plugin ID. The ring has two text lines and a three-line tooltip; notice cards appear below it. Do not render stale labels. Keep timestamps and failure retention accurate.
