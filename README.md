# Atlas Portal

Internal client portal for Osiris Labs marketing clients.

## Stack

- Next.js 16 App Router and TypeScript
- Drizzle ORM and PostgreSQL 16
- Better Auth email/password authentication
- Tailwind CSS and shadcn/ui (Base UI registry)

## Run the full stack

The VPS deployment and local production-like run use Docker Compose. Docker Engine, the Compose plugin, and GNU Make are required.

1. Create the production environment file:

   ```sh
   cp .env.production.example .env.production
   ```

2. Set `DOMAIN`, `POSTGRES_PASSWORD`, `ATLAS_ADMIN_PASSWORD`, and `BETTER_AUTH_SECRET`. Set `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` to `https://<DOMAIN>`. Use a URL-safe value for `POSTGRES_PASSWORD`, since Compose includes it in the internal Postgres connection URL. A random hexadecimal value works well, for example `openssl rand -hex 32`.
3. Start the full stack:

   ```sh
   make up
   ```

   This builds the app and tools images, starts PostgreSQL, runs committed Drizzle migrations and the seed once, then starts the app, prober, alert engine, and Caddy. Caddy obtains and renews public HTTPS certificates when `DOMAIN` resolves to this server and ports 80 and 443 are reachable. For a local smoke test, use `DOMAIN=localhost`; Caddy uses its local certificate authority in that case.

4. Open `https://<DOMAIN>`. Sign in as `ATLAS_ADMIN_EMAIL` (defaults to `admin@atlas.local`) with `ATLAS_ADMIN_PASSWORD` from `.env.production`. Public email/password sign-up is disabled; the seed enables it only in its own process to create the configured admin.

Useful operations:

```sh
make ps                 # service status
make logs               # follow service logs
make restart            # restart app and worker services
make migrate            # apply committed Drizzle migrations
make seed               # reconcile seed data and admin
make backup             # write a timestamped SQL dump under ./backups
make down               # stop the stack
```

Postgres is not published on a host port. The only published ports are 80 and 443 from Caddy. `.env.production` is ignored by Git; keep a secure copy for deployment and backups.

## Development

Install dependencies with `pnpm install`, configure `.env.local` with `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL`, then run:

```sh
pnpm dev
```

Database migrations are committed under `drizzle/`. `pnpm exec drizzle-kit migrate` applies them; do not use `db:push` for production. `pnpm db:seed` reconciles alert rules and ensures the configured admin exists.

## Useful scripts

- `pnpm build` — production build
- `pnpm db:seed` — reconcile alert rules and admin
- `pnpm logs:verify` — verify the Instagram automation logging pipeline writes to `logs`
- `pnpm alerts:dry-run` — run the alert engine without writing rows
- `pnpm alerts:run` — run the alert engine once
- `pnpm checks:run` — run due service checks once
- `pnpm import:clients <file.csv>` — bulk-import clients and assets
- `pnpm alerts:validate [hours]` — validation report for alerts in the last N hours

## Roles and pages

Roles: `admin`, `developer`, `legal`, `social_media_manager`, `content_creator`. Client management is limited to `admin` and `developer`.

- `/` — portal landing page
- `/clients` — client list
- `/clients/new` — create client
- `/clients/[id]` — role-scoped client detail, assets, and activity log
- `/dashboard` — admin KPIs, triage table, logs explorer, and NLP query box
- `/api/auth/[...all]` — Better Auth endpoints
- `/api/health` — database-backed health check with no data in its response
- `/api/nlp` — read-only NLP query endpoint

## Logging integration

The shared logger is in `app/lib/logger.ts`. The Instagram automation service should import `logInstagramEvent` and call it for webhook, DM send, token refresh, and API error events:

```ts
import { logInstagramEvent } from "@/app/lib/logger";

await logInstagramEvent("client_instagram_handle", "info", "DM sent successfully", {
  recipientId: "123",
});
```

Unmatched Instagram accounts are logged with `client_id = null` and flagged as unrecognised.

## Monitoring workers

The Compose `prober` service invokes `pnpm checks:run` every 60 seconds. Each check is self-gated by its own `interval_seconds`. The `alert-engine` service invokes `pnpm alerts:run` every 10 minutes. Both use the full-dependency tools target and write logs to Docker’s service output.

The systemd units in `deploy/systemd/` are retained as a **legacy alternative** for installations that deliberately run the workers outside Compose. The Compose deployment does not use them.

## Phase status

| Phase | Status |
| --- | --- |
| 1 — Foundation | Complete |
| 2 — Client CRUD + manual asset entry | Complete |
| 3 — Role-scoped client detail view | Complete |
| 4 — Logging pipeline | Complete (integration requires external automation service) |
| 5 — Alert engine | Complete |
| 6 — Admin dashboard | Complete |
| 7 — NLP query layer | Complete (requires LLM API key) |
| 8 — Real onboarding + VPS validation | Scripts ready; waiting on real client CSV |
