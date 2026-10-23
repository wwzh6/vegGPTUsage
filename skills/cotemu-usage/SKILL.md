---
name: cotemu-usage
description: Open 植被组额度查询 to view the group's centrally synchronized seven-day account usage or reset time.
---

Call `open_usage_ball` with empty arguments to open the panel. For a text check,
call `get_usage`; use `refresh: true` only when explicitly asked to refresh.
A refresh reads the private GitHub snapshot, not the upstream account API.

Members need repository read access through local GitHub login. Do not ask them
for COTEMU_API_KEY. The administrator configures one shared key in GitHub Actions
Secrets. Never print credentials, publish the full account list, or inspect
unrelated credentials. Shared data may be delayed and is not personal spending,
a balance, or guaranteed remaining capacity. Preserve stale and unknown states.

The app handles timers; do not create an automation or repeatedly call tools.
For missing GitHub access, use the repository installation workflow. Upstream key
errors require administrator repair and a manual run of Sync shared quota.
