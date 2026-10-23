---
name: cotemu-usage
description: Open or inspect 植被组额度查询 (Vegetation Group seven-day usage ring) when the user asks to view usage, open the ball, or check the seven-day reset time.
---

Call `open_usage_ball` with empty arguments to open the conversation panel. For a textual check, call `get_usage`; use `refresh: true` only for an explicit refresh.

Describe this as the key's bound OpenAI account's shared seven-day usage, not personal spend, a balance, or guaranteed remaining capacity. Preserve unknown, reference-only, stale, and connection-error labels. Never substitute another account or use account resume time for the seven-day reset.

If the key is missing, ask the user to configure `COTEMU_API_KEY` in the environment of the desktop process and restart the app. Do not ask them to paste the key into chat or inspect unrelated credentials. The app handles refresh timers; do not create an automation or repeatedly call tools.
