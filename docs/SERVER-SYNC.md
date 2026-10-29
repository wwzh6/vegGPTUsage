# Server synchronization

Use a Linux server with systemd and Node.js >=22.19. Members continue reading
GitHub snapshots and NOTICE.md; their installations and credentials do not change.
No inbound HTTP port or domain is required. Outbound HTTPS must reach GitHub and
cotemu.com. The server provides the regular schedule; GitHub Actions is a backup.

## Deployment

1. Verify the server, available Node executable, systemd, HTTPS connectivity and
   existing services before changing anything. Copy this reviewed repository to
   `/opt/vegetation-quota/current`, owned by root and readable by a dedicated, non-login
   `vegetation-quota` user. No npm install or build is needed on the server.
   To prepare the server-only bundle on the development computer, run
   `python scripts/package-server.py --output vegetation-quota-server.zip`.
   Runtime files must be root-owned with mode 0644 and directories mode 0755.
2. Through a secure local session, create `/etc/vegetation-quota/sync.env` with
   directory mode 0700 and file mode 0600, owned by root. Include `COTEMU_API_KEY`.
   For this public repository, set `VEGETATION_PUBLISH_TRANSPORT=git` and use a
   dedicated write-enabled repository deploy key. Configure `GIT_SSH_COMMAND`
   with its private key, `IdentitiesOnly=yes`, `BatchMode=yes`, strict host-key
   checking and a known-hosts file verified against GitHub's HTTPS metadata.
   Git writes only the `quota-data` branch and rejects conflicting updates.
   Keep the private key readable only by the service user. No personal GitHub
   token is stored on the server. For a private repository, the alternative API
   transport requires a repository-scoped `GITHUB_TOKEN` with Contents read/write
   and Actions read. Never paste credentials into chat, commands,
   repository files or logs. GitHub Secrets cannot be downloaded; the administrator
   must provision the account key once on this server.
3. During migration from older uncoordinated publishers, disable **Sync shared
   quota** and wait for running instances to finish. Deploy the current server
   and the current workflow together, then re-enable the workflow. Deploy only
   one primary server. Both publishers acquire an expiring lease using a
   non-forced Git update before querying; a conflicting update prevents querying.
4. Install the two files from `scripts/systemd/` into `/etc/systemd/system/`.
   The default uses an isolated Node runtime at `/opt/vegetation-quota/runtime`.
   Set ExecStart to the Node path actually verified on the server. Run
   `systemd-analyze verify` on both units, then `systemctl daemon-reload`.
5. Run `systemctl start vegetation-quota-sync.service`. Verify both service status
   and `quota-data/usage.json`: `state.error` must be null and `lastAttemptAtMs`,
   `lastCompletedAtMs`, `data.updatedAtMs` must be checked separately. A publication
   timestamp alone does not prove a fresh account sample.
6. Enable with `systemctl enable --now vegetation-quota-sync.timer`. Observe at
   least three successful timer runs, ten minutes apart, and a visible client
   refresh. Do not declare deployment complete based only on unit installation.

## Operation

- `systemctl start vegetation-quota-sync.service` requests one immediate run;
  systemd coalesces requests while that service is already running.
- The timer uses wall-clock ten-minute slots, with one catch-up after downtime.
  It does not replay every missed slot. A running service is not started twice.
- The server bypasses the client's ten-minute cache, preserving the shared
  15-second request floor, Retry-After and automatic pause after authorization
  errors. Failed queries publish retained data and fail the service visibly.
- The GitHub workflow sets `VEGETATION_BACKUP_ONLY=true`. It skips queries when
  the previous query completed less than 20 minutes ago, and takes over on a
  later workflow run if updates stop. GitHub schedule delays still apply, so
  20 minutes is an eligibility threshold, not a takeover-time guarantee.
- For a short recovery drill, pause the primary timer and manually dispatch the
  workflow with `force_takeover=true`. This bypasses only the freshness/cache
  wait, preserving the lease, 15-second floor, cooldown and authorization pause.
  Confirm a successful publication, then resume the primary timer. Normal
  scheduled runs never set this option.
- A 120-second lease prevents simultaneous publishers and expires after a crash.
  Acquiring a lease does not change the snapshot or its publication timestamp.
  GitHub coordination must be reachable to start a new upstream query.
- `VEGETATION_PUBLIC_DIRECTORY`, if configured, receives an atomic sanitized
  `usage.json` copy before GitHub publication. No web endpoint is enabled by this
  variable; a separate reviewed HTTPS route is needed for client direct reads.
- After replacing an invalid key, stop the timer and wait for the service to exit.
  Temporarily add `VEGETATION_MANUAL_REFRESH=true` to the root-only environment
  file, start the service once, remove that line, verify success and restart the
  timer. Do not leave manual recovery enabled for scheduled runs.
- Inspect sanitized results using `journalctl -u vegetation-quota-sync.service`
  and scheduling using `systemctl list-timers vegetation-quota-sync.timer`.
- To use GitHub alone, stop and disable the server timer; the backup workflow
  will become eligible when the last query is 20 minutes old. Both active
  publishers must use this lease protocol; do not restore older runtime files
  while the other publisher remains enabled.

The timer controls query attempts, not upstream availability or when Cotemu
refreshes account statistics. Clients independently read every ten minutes while
visible, so a successful new sample can take up to another ten minutes to appear.
Server/network outages and upstream cooldowns can still delay successful updates.
