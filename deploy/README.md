# Atlas Portal — schedulers

Two independent systemd timer/service pairs on the self-hosted VPS:

| unit pair | script | cadence | role |
| --- | --- | --- | --- |
| `atlas-prober` | `scripts/prober.ts` (`pnpm checks:run`) | every 1 min | probes each active `service_checks` row (self-gated on its own `interval_seconds`) and writes a `service_check_results` row |
| `atlas-alert-engine` | `scripts/alert-engine.ts` (`pnpm alerts:run`) | every 10 min | reads `service_check_results` (+ logs / asset metadata) and writes/updates `alerts` |

**Ordering:** there is **no hard systemd dependency** between the two timers —
they run on their own schedules. The prober simply needs to have run recently
for the alert engine's `uptime` / `website_outage_minutes` / `backend_error_rate`
metrics to be accurate: those are computed from the freshness and status of
`service_check_results` rows. With the prober on a 1-minute cadence and the
alert engine on 10 minutes, the engine always sees results at most ~1 minute
old. If the prober timer is stopped, those three metrics go stale (uptime
falls back to "100% / no data" and outage reports "no probe data yet") while
the metadata-driven rules (`contract_expiry_days`, `record_staleness_days`,
`sync_staleness_hours`) are unaffected.

## Alert engine — runs `scripts/alert-engine.ts` every 10 minutes

## Choice: systemd timer (not cron)

The VPS is a self-hosted Ubuntu/Debian box running Docker Compose (Postgres on
host port 5433). systemd is its default init, and the build spec explicitly
lists a systemd timer as an acceptable scheduler. It is preferred over cron
because:

- `Persistent=true` runs a missed invocation after boot/reboot (the engine is
  idempotent, so catch-up is safe).
- No cron `$PATH`/mail surprises — env and working dir are set declaratively.
- Output is captured by journald and optionally mirrored to a log file.

## Assumption about logging

The engine is executed **on the host** (matching the README deployment
checklist: Postgres in Docker, app + scripts on the host), so its
`console.log`/`console.error` output — the existing logging convention — is
captured by systemd. If you instead run the whole stack inside containers,
drop the `StandardOutput=` lines from the service unit and let Docker capture
stdout; the timer unit is unchanged.

The engine loads `.env.local` itself via `scripts/env.ts` (it is the first
import in `scripts/alert-engine.ts`), so the unit deliberately sets **no**
environment/EnvironmentFile — no separate env handling.

## Install (as root on the VPS)

```bash
# 1. Copy the units
sudo cp deploy/systemd/atlas-alert-engine.service /etc/systemd/system/
sudo cp deploy/systemd/atlas-alert-engine.timer /etc/systemd/system/

# 2. Optional: create a dedicated service user (or point User=/Group= in the
#    unit at the account that owns /opt/atlas-portal)
sudo useradd --system --home /opt/atlas-portal --shell /usr/sbin/nologin atlas
sudo chown -R atlas:atlas /opt/atlas-portal

# 3. Reload, enable, start
sudo systemctl daemon-reload
sudo systemctl enable atlas-alert-engine.timer
sudo systemctl start atlas-alert-engine.timer

# 4. Verify
systemctl list-timers atlas-alert-engine        # shows next 10-minute fire time
systemctl status atlas-alert-engine.timer
```

## Run it once manually (smoke test)

```bash
sudo systemctl run atlas-alert-engine.service
tail -f /var/log/atlas-alert-engine.log
```

## Logs

- File: `/var/log/atlas-alert-engine.log` (append mode, per the service unit).
- Journald: `journalctl -u atlas-alert-engine --since "10 minutes ago"`.

## Cron alternative

If you decide against systemd for any reason, this crontab line is equivalent
(uses the same loader chain, logs to the same file):

```cron
*/10 * * * * cd /opt/atlas-portal && /usr/local/bin/pnpm alerts:run >> /var/log/atlas-alert-engine.log 2>&1
```

Install with `crontab -e` under the user that owns `/opt/atlas-portal`.

---

## Service prober — runs `scripts/prober.ts` every minute

Same design rationale as the alert engine (systemd timer, run on the host,
`Persistent=true`, loads `.env.local` via `scripts/env.ts` as its first import,
so the unit sets no environment/EnvironmentFile).

Each `service_checks` row carries its own `interval_seconds`; `main()` in
`scripts/prober.ts` skips a check whose most recent `service_check_results` row
is newer than that interval. A 1-minute timer cadence is therefore safe — it is
the *minimum* poll granularity, not the per-check rate.

### Install (as root on the VPS)

```bash
# 1. Copy the units
sudo cp deploy/systemd/atlas-prober.service /etc/systemd/system/
sudo cp deploy/systemd/atlas-prober.timer /etc/systemd/system/

# 2. (service user already created for the alert engine above — reuse it)

# 3. Reload, enable, start
sudo systemctl daemon-reload
sudo systemctl enable atlas-prober.timer
sudo systemctl start atlas-prober.timer

# 4. Verify
systemctl list-timers atlas-prober          # shows next 1-minute fire time
systemctl status atlas-prober.timer
```

### Run it once manually (smoke test)

```bash
sudo systemctl start atlas-prober.service
tail -f /var/log/atlas-prober.log
# or, without systemd:
cd /opt/atlas-portal && pnpm checks:dry-run   # runs every check, writes nothing
```

### Logs

- File: `/var/log/atlas-prober.log` (append mode, per the service unit).
- Journald: `journalctl -u atlas-prober --since "5 minutes ago"`.

### Cron alternative

```cron
* * * * * cd /opt/atlas-portal && /usr/local/bin/pnpm checks:run >> /var/log/atlas-prober.log 2>&1
```