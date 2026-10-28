import "./env";
import { db } from "../app/lib/db";
import { clients, clientAssets, logs, alertRules, serviceChecks } from "../app/lib/schema";
import { eq, and, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Demo seed data for the REAL dev database (the DATABASE_URL from .env.local).
//
// Idempotent: if a client name already exists, that client is skipped entirely
// (assets + logs too), so re-running never duplicates. Existing rows (e.g. the
// "Youssef" client) are never touched or deleted. seedServiceChecks() runs
// regardless and only adds missing rows.
//
// Deliberate alert scenarios (so the dashboard is not all green):
//   - Maya Fitness social  -> sync_staleness_hours WARNING (>6h)
//   - Nour Bakery contract -> contract_expiry_days WARNING (<30 days)
//   - Delta social         -> sync_staleness + record_staleness WARNING
//
// uptime / website_outage_minutes / backend_error_rate are no longer seeded as
// fabricated `logs` rows — they are driven by real service_check_results written
// by scripts/prober.ts against the service_checks rows seeded below.
// ---------------------------------------------------------------------------

const now = Date.now();
const minsAgo = (m: number) => new Date(now - m * 60_000);
const hoursAgo = (h: number) => new Date(now - h * 3_600_000);
const daysAgo = (d: number, extraMin = 0) =>
  new Date(now - d * 86_400_000 - extraMin * 60_000);

type Level = "info" | "warning" | "error";

async function getOrCreateClient(name: string, tier: "starter" | "growth" | "enterprise", status: "onboarding" | "active" | "at_risk" | "paused" | "offboarded") {
  const existing = await db
    .select()
    .from(clients)
    .where(eq(clients.name, name))
    .limit(1);
  if (existing.length > 0) {
    console.log(`Client already exists, skipping: ${name}`);
    return null;
  }
  const [client] = await db
    .insert(clients)
    .values({ name, tier, status })
    .returning();
  console.log(`Created client: ${name} (${client.id})`);
  return client;
}

async function insertAsset(clientId: string, assetType: "website" | "app" | "chatbot" | "document" | "social", name: string, meta: Record<string, unknown>, updatedAt?: Date) {
  const [asset] = await db
    .insert(clientAssets)
    .values({
      clientId,
      assetType,
      name,
      meta,
      sourceType: "manual",
      status: "active",
      updatedAt: updatedAt ?? new Date(now),
    })
    .returning();
  return asset;
}

async function insertLogs(rows: { clientId: string; assetId: string; level: Level; source: string; message: string; createdAt: Date }[]) {
  await db
    .insert(logs)
    .values(rows.map((r) => ({ ...r, raw: null })));
}

/** Daily-ish info history for an asset, 45 days back, with occasional
 *  warnings/errors on some days — gives the explorer/staleness spread. */
function historyLogs(opts: { clientId: string; assetId: string; source: string; days: number; level: Level; message: (t: Date) => string }): { clientId: string; assetId: string; level: Level; source: string; message: string; createdAt: Date }[] {
  const out: { clientId: string; assetId: string; level: Level; source: string; message: string; createdAt: Date }[] = [];
  for (let d = opts.days; d >= 1; d--) {
    const t = daysAgo(d, Math.floor(Math.random() * 60 * 12));
    out.push({ clientId: opts.clientId, assetId: opts.assetId, level: opts.level, source: opts.source, message: opts.message(t), createdAt: t });
  }
  return out;
}

const CHAT_OK = [
  "Webhook received from Instagram",
  "DM sent to user",
  "Comment reply delivered",
  "Order enquiry triaged to human agent",
];
const CHAT_WARN = ["Instagram rate limit approaching (80%)", "Media fetch slow (1100ms)", "Webhook retry queued"];
const CHAT_ERR = ["Webhook timeout after 3 retries", "DM send failed: unauthorized", "Instagram session token expired"];
const SOCIAL_OK = ["Instagram sync completed (12 new posts)", "Story metrics pulled (3,412 views)"];
const SOCIAL_WARN = ["Sync partial — 2 media items failed", "Instagram rate limited during sync"];
const SOCIAL_ERR = ["Sync failed: login required", "Media upload failed: timeout"];
const DOC_OK = ["Contract file stored in vault", "Version 2 uploaded"];

async function ensureOutageRule() {
  const existing = await db
    .select()
    .from(alertRules)
    .where(eq(alertRules.metric, "website_outage_minutes"))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(alertRules).values({
      name: "Website outage (continuous down)",
      description:
        "Critical when a website has been continuously down (no successful probe) for more than this many minutes.",
      assetType: "website",
      metric: "website_outage_minutes",
      windowMinutes: null,
      warningThreshold: null,
      criticalThreshold: 5,
      enabled: true,
    });
    console.log("Inserted alert rule: Website outage (continuous down)");
  }
}

const DEMO_CLIENT_NAMES = [
  "Nour Bakery",
  "Maya Fitness Studio",
  "Omar Electronics",
  "Delta Consulting",
  "Leila Wellness Spa",
];

// Example service_checks for demo website/app assets. Real, stable public
// targets so `pnpm checks:run` produces genuine service_check_results. The
// alert engine then evaluates uptime / outage / backend_error_rate from those.
const DEMO_SERVICE_CHECKS: {
  assetName: string;
  checkType: "http" | "api" | "db" | "webhook";
  name: string;
  target: string;
  config: Record<string, unknown>;
  intervalSeconds: number;
}[] = [
  {
    assetName: "Maya Fitness Site",
    checkType: "http",
    name: "Maya Fitness Site — homepage HTTP",
    target: "https://httpbin.org/status/200",
    config: {
      method: "GET",
      expectedStatus: [200, 299],
      latencyWarningMs: 2000,
      timeoutMs: 15000,
    },
    intervalSeconds: 300,
  },
  {
    assetName: "Maya Fitness App",
    checkType: "api",
    name: "Maya Fitness App — /json API health",
    target: "https://httpbin.org/json",
    config: {
      method: "GET",
      expectedStatus: [200, 299],
      headers: { Accept: "application/json" },
      expectedField: "slideshow.title",
      expectedValue: "Sample Slide Show",
      latencyWarningMs: 2000,
      timeoutMs: 15000,
    },
    intervalSeconds: 300,
  },
  {
    assetName: "Nour Bakery Site",
    checkType: "http",
    name: "Nour Bakery Site — homepage HTTP",
    target: "https://httpbin.org/status/200",
    config: {
      method: "GET",
      expectedStatus: [200, 299],
      latencyWarningMs: 2500,
      timeoutMs: 15000,
    },
    intervalSeconds: 300,
  },
  {
    // Deliberately unhealthy target so the demo dashboard is not all green:
    // this check returns 503, driving uptime -> critical and outage minutes up.
    assetName: "Omar Electronics Store",
    checkType: "http",
    name: "Omar Electronics Store — homepage HTTP",
    target: "https://httpbin.org/status/503",
    config: {
      method: "GET",
      expectedStatus: [200, 299],
      latencyWarningMs: 2500,
      timeoutMs: 15000,
    },
    intervalSeconds: 300,
  },
];

/** Idempotently attach the demo service_checks above to existing assets by
 *  name. Runs on every seed, independent of whether clients were just created. */
async function seedServiceChecks() {
  for (const def of DEMO_SERVICE_CHECKS) {
    const [asset] = await db
      .select({ id: clientAssets.id })
      .from(clientAssets)
      .where(eq(clientAssets.name, def.assetName))
      .limit(1);
    if (!asset) {
      console.log(`Service check skipped — asset not found: ${def.assetName}`);
      continue;
    }
    const existing = await db
      .select({ id: serviceChecks.id })
      .from(serviceChecks)
      .where(
        and(
          eq(serviceChecks.assetId, asset.id),
          eq(serviceChecks.name, def.name)
        )
      )
      .limit(1);
    if (existing.length > 0) {
      console.log(`Service check already exists: ${def.name}`);
      continue;
    }
    await db.insert(serviceChecks).values({
      assetId: asset.id,
      checkType: def.checkType,
      name: def.name,
      target: def.target,
      config: def.config,
      intervalSeconds: def.intervalSeconds,
      isActive: true,
    });
    console.log(`Inserted service check: ${def.name}`);
  }
}

/** Deletes the demo clients (and their logs/assets/alerts) so the seed can be
 *  re-run cleanly. Never touches any other client (e.g. "Youssef"). */
async function resetDemoData() {
  const ids = await db
    .select({ id: clients.id })
    .from(clients)
    .where(inArray(clients.name, DEMO_CLIENT_NAMES));
  if (ids.length === 0) return;
  await db.delete(logs).where(inArray(logs.clientId, ids.map((r) => r.id)));
  await db.delete(clients).where(inArray(clients.id, ids.map((r) => r.id)));
  console.log(`Reset: removed ${ids.length} demo client(s) and their data`);
}

async function seed() {
  if (process.argv.includes("--reset")) {
    await resetDemoData();
  }

  await ensureOutageRule();

  // ------------------------------------------------------------------ Nour Bakery
  const nour = await getOrCreateClient("Nour Bakery", "growth", "active");
  if (nour) {
    await insertAsset(nour.id, "website", "Nour Bakery Site", {
      url: "https://nourbakery.example",
      hostingProvider: "Vercel",
      cms: "Shopify",
    });
    const bot = await insertAsset(nour.id, "chatbot", "Nour Bakery Instagram Bot", {
      platform: "instagram",
      triggerKeywords: "menu, order, delivery, opening hours",
      linkedAccount: "nour.bakery",
    });
    const social = await insertAsset(nour.id, "social", "Nour Bakery Instagram", {
      platform: "instagram",
      handle: "@nour.bakery",
      followerCount: 18400,
      connected: true,
    });
    const contract = await insertAsset(nour.id, "document", "Nour Bakery — Supplier Contract", {
      fileName: "nour-bakery-supplier-contract.pdf",
      docType: "contract",
      expiryDate: new Date(now + 20 * 86_400_000).toISOString().slice(0, 10),
    });

    // Website health is now driven by a real service_checks row (see
    // seedServiceChecks) + scripts/prober.ts — no fabricated uptime logs here.

    // Chatbot: burst of instagram-automation history in the last hour.
    const burst: { clientId: string; assetId: string; level: Level; source: string; message: string; createdAt: Date }[] = [];
    for (let i = 0; i < 28; i++) {
      const t = minsAgo(1 + Math.floor((i / 28) * 54));
      const isError = [0, 3, 7, 11, 16, 22, 25].includes(i);
      burst.push({
        clientId: nour.id,
        assetId: bot.id,
        level: isError ? "error" : "info",
        source: "instagram-automation",
        message: isError ? CHAT_ERR[i % CHAT_ERR.length] : CHAT_OK[i % CHAT_OK.length],
        createdAt: t,
      });
    }
    await insertLogs(burst);
    await insertLogs(historyLogs({ clientId: nour.id, assetId: bot.id, source: "instagram-automation", days: 45, level: "info", message: () => CHAT_OK[Math.floor(Math.random() * CHAT_OK.length)] }));

    // Social: healthy (last sync 2h ago).
    await insertLogs([
      { clientId: nour.id, assetId: social.id, level: "info", source: "social-sync", message: SOCIAL_OK[0], createdAt: hoursAgo(2) },
      { clientId: nour.id, assetId: social.id, level: "warning", source: "social-sync", message: SOCIAL_WARN[1], createdAt: daysAgo(9, 120) },
    ]);

    // Document: a couple of lifecycle logs.
    await insertLogs([
      { clientId: nour.id, assetId: contract.id, level: "info", source: "contract-service", message: DOC_OK[0], createdAt: daysAgo(40, 300) },
    ]);
  }

  // ------------------------------------------------------------------ Maya Fitness Studio
  const maya = await getOrCreateClient("Maya Fitness Studio", "enterprise", "active");
  if (maya) {
    await insertAsset(maya.id, "website", "Maya Fitness Site", {
      url: "https://mayafitness.example",
      hostingProvider: "DigitalOcean",
      cms: "Next.js",
    });
    await insertAsset(maya.id, "app", "Maya Fitness App", {
      platform: "iOS + Android",
      version: "4.2.1",
      repoUrl: "https://github.com/osiris-labs/maya-fitness",
    });
    const social = await insertAsset(maya.id, "social", "Maya Fitness Instagram", {
      platform: "instagram",
      handle: "@mayafitness.studio",
      followerCount: 45200,
      connected: true,
    });
    const bot = await insertAsset(maya.id, "chatbot", "Maya Fitness Booking Bot", {
      platform: "instagram",
      triggerKeywords: "book, class, schedule, membership",
      linkedAccount: "mayafitness.studio",
    });

    // Website + app health (uptime / outage / backend_error_rate) are driven by
    // real service_checks + scripts/prober.ts now — no fabricated logs here.

    // Social: STALE (last sync 20h ago -> sync_staleness warning).
    await insertLogs([
      { clientId: maya.id, assetId: social.id, level: "info", source: "social-sync", message: SOCIAL_OK[0], createdAt: hoursAgo(20) },
      { clientId: maya.id, assetId: social.id, level: "info", source: "social-sync", message: SOCIAL_OK[1], createdAt: daysAgo(4, 60) },
    ]);

    // Chatbot: healthy, no recent errors.
    await insertLogs([
      { clientId: maya.id, assetId: bot.id, level: "info", source: "instagram-automation", message: CHAT_OK[0], createdAt: hoursAgo(2) },
      { clientId: maya.id, assetId: bot.id, level: "warning", source: "instagram-automation", message: CHAT_WARN[0], createdAt: daysAgo(6, 240) },
    ]);
  }

  // ------------------------------------------------------------------ Omar Electronics
  const omar = await getOrCreateClient("Omar Electronics", "growth", "active");
  if (omar) {
    await insertAsset(omar.id, "website", "Omar Electronics Store", {
      url: "https://omarelectronics.example",
      hostingProvider: "AWS",
      cms: "WooCommerce",
    });
    await insertAsset(omar.id, "app", "Omar Electronics App", {
      platform: "Android",
      version: "2.7.0",
      repoUrl: "https://github.com/osiris-labs/omar-electronics",
    });
    const bot = await insertAsset(omar.id, "chatbot", "Omar Electronics WhatsApp Bot", {
      platform: "whatsapp",
      triggerKeywords: "warranty, price, specs, order status",
      linkedAccount: "omarelectronics",
    });
    const contract = await insertAsset(omar.id, "document", "Omar Electronics — Warehouse Lease", {
      fileName: "omar-warehouse-lease.pdf",
      docType: "contract",
      expiryDate: new Date(now + 200 * 86_400_000).toISOString().slice(0, 10),
    });

    // Website + app health are driven by real service_checks + prober now.

    // Healthy chatbot.
    await insertLogs([
      { clientId: omar.id, assetId: bot.id, level: "info", source: "instagram-automation", message: CHAT_OK[1], createdAt: hoursAgo(4) },
      { clientId: omar.id, assetId: bot.id, level: "error", source: "instagram-automation", message: CHAT_ERR[2], createdAt: daysAgo(20, 180) },
    ]);
    await insertLogs(historyLogs({ clientId: omar.id, assetId: bot.id, source: "instagram-automation", days: 45, level: "info", message: () => CHAT_OK[Math.floor(Math.random() * CHAT_OK.length)] }));

    // Document: far-future expiry (no alert).
    await insertLogs([
      { clientId: omar.id, assetId: contract.id, level: "info", source: "contract-service", message: DOC_OK[0], createdAt: daysAgo(50, 120) },
    ]);
  }

  // ------------------------------------------------------------------ Delta Consulting
  const delta = await getOrCreateClient("Delta Consulting", "enterprise", "active");
  if (delta) {
    await insertAsset(delta.id, "website", "Delta Consulting Site", {
      url: "https://deltaconsulting.example",
      hostingProvider: "Cloudflare",
      cms: "Astro",
    });
    await insertAsset(delta.id, "app", "Delta Consulting Intranet", {
      platform: "Web",
      version: "1.9.3",
      repoUrl: "https://github.com/osiris-labs/delta-intranet",
    });
    // Dormant social: last sync 30 days ago + record untouched for 70 days.
    const social = await insertAsset(
      delta.id,
      "social",
      "Delta Consulting LinkedIn",
      { platform: "linkedin", handle: "delta-consulting", followerCount: 3100, connected: false },
      daysAgo(70)
    );
    const contract = await insertAsset(delta.id, "document", "Delta Consulting — Client Retainer", {
      fileName: "delta-client-retainer.pdf",
      docType: "contract",
      expiryDate: new Date(now + 150 * 86_400_000).toISOString().slice(0, 10),
    });

    // Website + app health are driven by real service_checks + prober now.

    // Stale social -> sync_staleness warning (>6h) + record_staleness warning (>60d).
    await insertLogs([
      { clientId: delta.id, assetId: social.id, level: "info", source: "social-sync", message: SOCIAL_OK[0], createdAt: daysAgo(30, 30) },
    ]);
    await insertLogs([
      { clientId: delta.id, assetId: contract.id, level: "info", source: "contract-service", message: DOC_OK[1], createdAt: daysAgo(35, 100) },
    ]);
  }

  // ------------------------------------------------------------------ Leila Wellness Spa
  const leila = await getOrCreateClient("Leila Wellness Spa", "starter", "active");
  if (leila) {
    await insertAsset(leila.id, "website", "Leila Wellness Site", {
      url: "https://leilawellness.example",
      hostingProvider: "Hostinger",
      cms: "WordPress",
    });
    const bot = await insertAsset(leila.id, "chatbot", "Leila Wellness Booking Bot", {
      platform: "instagram",
      triggerKeywords: "book, spa, massage, appointment",
      linkedAccount: "leila.wellness",
    });
    const social = await insertAsset(leila.id, "social", "Leila Wellness Instagram", {
      platform: "instagram",
      handle: "@leila.wellness",
      followerCount: 6200,
      connected: true,
    });
    const doc = await insertAsset(leila.id, "document", "Leila Wellness — Brand Guide", {
      fileName: "leila-brand-guide.pdf",
      docType: "brand_guide",
      expiryDate: null,
    });

    // Website health is driven by real service_checks + prober now.

    // Healthy chatbot + social (social synced recently enough to stay under the
    // 6h staleness threshold even with the dev DB's timestamp skew).
    await insertLogs([
      { clientId: leila.id, assetId: bot.id, level: "info", source: "instagram-automation", message: CHAT_OK[3], createdAt: hoursAgo(3) },
      { clientId: leila.id, assetId: social.id, level: "info", source: "social-sync", message: SOCIAL_OK[1], createdAt: hoursAgo(1.5) },
    ]);
    await insertLogs(historyLogs({ clientId: leila.id, assetId: bot.id, source: "instagram-automation", days: 45, level: "info", message: () => CHAT_OK[Math.floor(Math.random() * CHAT_OK.length)] }));
  }

  await seedServiceChecks();

  console.log("Demo seed complete.");
}

seed().catch((err) => {
  console.error("Demo seed failed:", err);
  process.exit(1);
});