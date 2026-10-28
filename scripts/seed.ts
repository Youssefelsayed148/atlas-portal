import "./env";
import { db } from "../app/lib/db";
import { auth } from "../app/lib/auth";
import { alertRules, user } from "../app/lib/schema";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = "admin@atlas.local";
const ADMIN_PASSWORD = "AtlasAdmin123!";
const ADMIN_NAME = "Atlas Admin";

const alertRuleSeedData = [
  {
    name: "Website uptime",
    description: "Website uptime percentage over the last 24 hours.",
    assetType: "website",
    metric: "uptime",
    windowMinutes: 24 * 60,
    warningThreshold: 99.7,
    criticalThreshold: 95,
    enabled: true,
  },
  {
    name: "Website outage (continuous down)",
    description:
      "Critical when a website has been continuously down (no successful probe) for more than this many minutes.",
    assetType: "website",
    metric: "website_outage_minutes",
    windowMinutes: null,
    warningThreshold: null,
    criticalThreshold: 5,
    enabled: true,
  },
  {
    name: "Social sync staleness",
    description: "Time since the last successful social sync.",
    assetType: "social",
    metric: "sync_staleness_hours",
    windowMinutes: null,
    warningThreshold: 6,
    criticalThreshold: null,
    enabled: true,
  },
  {
    name: "App backend error rate",
    description: "Percentage of app backend errors over the window.",
    assetType: "app",
    metric: "backend_error_rate",
    windowMinutes: 60,
    warningThreshold: 2,
    criticalThreshold: 10,
    enabled: true,
  },
  {
    name: "Contract expiry",
    description: "Days remaining until a document contract expires.",
    assetType: "document",
    metric: "contract_expiry_days",
    windowMinutes: null,
    warningThreshold: 30,
    criticalThreshold: null,
    enabled: true,
  },
  {
    name: "Record staleness",
    description: "Time since any client asset was last updated.",
    assetType: null,
    metric: "record_staleness_days",
    windowMinutes: null,
    warningThreshold: 60,
    criticalThreshold: null,
    enabled: true,
  },
] as const;

async function seed() {
  // 0. Drop retired rules. webhook_error_rate (Instagram chatbot) is out of
  //    scope for the generic monitoring system and its engine branch is gone.
  const removed = await db
    .delete(alertRules)
    .where(eq(alertRules.metric, "webhook_error_rate"))
    .returning({ id: alertRules.id });
  if (removed.length > 0) {
    console.log(`Removed ${removed.length} retired alert rule(s): webhook_error_rate`);
  }

  // 1. Seed / reconcile alert rules. Insert when missing; otherwise update the
  //    tunable fields so a re-run picks up threshold changes (e.g. the uptime
  //    critical threshold).
  for (const rule of alertRuleSeedData) {
    const existing = await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.metric, rule.metric));
    if (existing.length === 0) {
      await db.insert(alertRules).values({
        ...rule,
        // Drizzle enum columns expect the typed value; null is acceptable for optional columns.
        assetType: rule.assetType as any,
      });
      console.log(`Inserted alert rule: ${rule.name}`);
    } else {
      await db
        .update(alertRules)
        .set({
          name: rule.name,
          description: rule.description,
          assetType: rule.assetType as any,
          windowMinutes: rule.windowMinutes,
          warningThreshold: rule.warningThreshold,
          criticalThreshold: rule.criticalThreshold,
          enabled: rule.enabled,
        })
        .where(eq(alertRules.metric, rule.metric));
      console.log(`Reconciled alert rule: ${rule.name}`);
    }
  }

  // 2. Create admin user (email/password only)
  const existingAdmin = await db
    .select()
    .from(user)
    .where(eq(user.email, ADMIN_EMAIL));

  if (existingAdmin.length === 0) {
    const signUp = await auth.api.signUpEmail({
      headers: new Headers({ origin: process.env.BETTER_AUTH_URL! }),
      body: {
        name: ADMIN_NAME,
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      },
    });

    if (!signUp.user) {
      throw new Error("Failed to create admin user");
    }

    await db
      .update(user)
      .set({
        role: "admin",
        emailVerified: true,
      })
      .where(eq(user.id, signUp.user.id));

    console.log(`Created admin user: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  } else {
    console.log(`Admin user already exists: ${ADMIN_EMAIL}`);
  }

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
