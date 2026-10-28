# Atlas Portal

Standalone internal client portal for Osiris Labs marketing clients. Built from the `client-portal-v1-build-spec.md` in phases.

## Tech stack

- Next.js 16 (App Router, TypeScript)
- Drizzle ORM + PostgreSQL
- Better-Auth (email/password + role field)
- Tailwind CSS + shadcn/ui (Base UI registry)

## Local setup

1. Start the Postgres container:

   ```bash
   docker compose up -d
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Copy the example env file:

   ```bash
   cp .env.example .env.local
   ```

   The default `.env.local` already points at the Dockerized database on port `5433`.

4. Push the Drizzle schema to the database:

   ```bash
   pnpm db:push
   ```

5. Set the admin password in `.env.local` (or `.env.production` on the server), then seed alert rules and the admin user:

   ```bash
   # .env.local / .env.production
   ATLAS_ADMIN_PASSWORD=<at least 12 characters>
   # optional, defaults to admin@atlas.local
   ATLAS_ADMIN_EMAIL=you@example.com
   ```

   ```bash
   pnpm db:seed
   ```

   Public sign-up is disabled; the seed script is the only way to create the first account.

6. Run the dev server:

   ```bash
   pnpm dev
   ```

7. Open [http://localhost:3000](http://localhost:3000). The homepage shows the current database connection status.

## Useful scripts

- `pnpm dev` — start Next.js dev server
- `pnpm build` — production build
- `pnpm db:push` — push Drizzle schema changes to Postgres
- `pnpm db:seed` — seed alert rules and admin user
- `pnpm logs:verify` — verify the Instagram automation logging pipeline writes to `logs`
- `pnpm alerts:dry-run` — run the alert engine without writing rows
- `pnpm alerts:run` — run the alert engine (run from cron in production)
- `pnpm import:clients <file.csv>` — bulk-import clients + assets
- `pnpm alerts:validate [hours]` — validation report for alerts in the last N hours

## Docker Compose services

- `postgres` — PostgreSQL 16, exposed on host port `5433` with volume `atlas_portal_data`.

## Environment variables

Copy `.env.example` to `.env.local` and adjust:

- `DATABASE_URL` — Postgres connection string
- `BETTER_AUTH_SECRET` — long random secret for auth tokens
- `BETTER_AUTH_URL` — public URL of the app
- `ATLAS_ADMIN_PASSWORD` — required by `pnpm db:seed` (min 12 chars)
- `NEXT_PUBLIC_APP_URL` — public URL of the app
- `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` — optional, required only for the NLP query box

## Roles

`admin`, `developer`, `legal`, `social_media_manager`, `content_creator`

Asset-type permissions follow the visibility matrix in the build spec. Client management is limited to `admin` and `developer` as a deliberate Phase 2 edge-case decision.

## Pages

- `/` — DB connection status + link to clients
- `/clients` — client list (admin/developer create)
- `/clients/new` — create client
- `/clients/[id]` — role-scoped client detail with assets and activity log
- `/dashboard` — admin-only KPIs, triage table, logs explorer, NLP query box
- `/api/auth/[...all]` — Better-Auth endpoints
- `/api/nlp` — read-only NLP query endpoint

## Logging integration (Instagram automation service)

The shared logger is in `app/lib/logger.ts`. Import `logInstagramEvent` from the automation service and call it for every webhook, DM send, token refresh, and API error event:

```ts
import { logInstagramEvent } from "@/app/lib/logger";

await logInstagramEvent(
  "client_instagram_handle",
  "info", // or "warning" / "error"
  "DM sent successfully",
  { recipientId: "123" }
);
```

If the Instagram account is not matched to a chatbot asset, the event is still logged with `client_id = null` and flagged as unrecognised.

## Alert engine

`scripts/alert-engine.ts` reads enabled `alert_rules`, computes metrics from `logs` and `client_assets`, and writes/updates `alerts`. It is idempotent — running twice without new data does not duplicate open alerts. Run it from a cron job or systemd timer in production, e.g. every 5 minutes:

```cron
*/5 * * * * cd /opt/atlas-portal && pnpm alerts:run >> /var/log/atlas-alerts.log 2>&1
```

## Deployment checklist (VPS)

1. Copy source to the VPS.
2. `cp .env.example .env.local` and fill real values.
3. `docker compose up -d` to start Postgres.
4. `pnpm install && pnpm db:push && pnpm db:seed`.
5. Build the app: `pnpm build`.
6. Start the Next.js server (or use a process manager like PM2).
7. Register the alert-engine cron job.
8. Wire the Instagram automation service to call `logInstagramEvent`.
9. Run `pnpm logs:verify` to confirm events reach the DB.
10. After the first 48h, run `pnpm alerts:validate 48` and manually spot-check a few clients before trusting dashboard numbers.

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
