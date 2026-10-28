import "./env";
import { db } from "../app/lib/db";
import { alerts, alertRules } from "../app/lib/schema";
import { eq, gte, desc } from "drizzle-orm";

// Window for the first 48h after going live.
const WINDOW_HOURS = parseInt(process.argv[2] ?? "48", 10);
const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

async function main() {
  const rules = await db.select().from(alertRules);
  const ruleMap = new Map(rules.map((r) => [r.id, r]));

  const recentAlerts = await db
    .select()
    .from(alerts)
    .where(gte(alerts.triggeredAt, since))
    .orderBy(desc(alerts.triggeredAt));

  console.log(`Alert validation report — last ${WINDOW_HOURS} hours\n`);
  console.log(`Total alerts generated: ${recentAlerts.length}\n`);

  const byRule: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const alert of recentAlerts) {
    const ruleName = ruleMap.get(alert.ruleId)?.name ?? alert.ruleId;
    byRule[ruleName] = (byRule[ruleName] ?? 0) + 1;
    bySeverity[alert.severity] = (bySeverity[alert.severity] ?? 0) + 1;
  }

  console.log("By rule:");
  for (const [name, count] of Object.entries(byRule)) {
    console.log(`  ${name}: ${count}`);
  }

  console.log("\nBy severity:");
  for (const [severity, count] of Object.entries(bySeverity)) {
    console.log(`  ${severity}: ${count}`);
  }

  console.log("\nSpot-check instructions:");
  console.log(
    "1. Pick 3-5 clients with open alerts and manually inspect their recent logs."
  );
  console.log(
    "2. Verify the computed values (error rates, uptime, staleness) match the raw logs."
  );
  console.log(
    "3. If thresholds feel too sensitive or too lax, tune warning_threshold / critical_threshold in alert_rules."
  );
  console.log(
    "4. Re-run this script after the first 48h to confirm alert accuracy before trusting the dashboard numbers."
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("Validation report failed:", err);
  process.exit(1);
});
