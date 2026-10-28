import "./env";
import { db } from "../app/lib/db";
import {
  alertRules,
  alerts,
  clientAssets,
  logs,
  serviceChecks,
  serviceCheckResults,
} from "../app/lib/schema";
import { eq, and, gte, sql, isNull, desc } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");

type AlertRule = typeof alertRules.$inferSelect;

interface ComputedResult {
  clientId: string;
  assetId?: string | null;
  /** Set when the result originates from a specific service_checks row. */
  checkId?: string | null;
  value: number;
  severity: "info" | "warning" | "critical";
  message: string;
}

function windowAgo(minutes: number | null) {
  if (!minutes) return new Date(0);
  return new Date(Date.now() - minutes * 60 * 1000);
}

function formatNumber(n: number) {
  if (!Number.isFinite(n)) return "∞";
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

/**
 * Single source of truth for turning a numeric metric value + a rule's two
 * thresholds into a severity. `direction` says which way across a threshold is
 * the bad direction:
 *   - 'above_is_worse'  → error rates, outage minutes, staleness
 *   - 'below_is_worse'  → uptime %, days-until-contract-expiry
 * A null threshold means that tier can never trigger. Comparisons are strict
 * (`>` / `<`), matching every branch this replaced.
 */
function computeSeverity(
  value: number,
  warningThreshold: number | null,
  criticalThreshold: number | null,
  direction: "above_is_worse" | "below_is_worse"
): "info" | "warning" | "critical" {
  const crossed = (threshold: number | null): boolean => {
    if (threshold == null) return false;
    return direction === "above_is_worse"
      ? value > threshold
      : value < threshold;
  };
  if (crossed(criticalThreshold)) return "critical";
  if (crossed(warningThreshold)) return "warning";
  return "info";
}

function thresholdText(rule: AlertRule): string {
  const w = rule.warningThreshold != null ? formatNumber(rule.warningThreshold) : "—";
  const c = rule.criticalThreshold != null ? formatNumber(rule.criticalThreshold) : "—";
  return `warn ${w} / crit ${c}`;
}

// ------------------------------------------------------------------
// Generic service-check evaluator
// ------------------------------------------------------------------
// Covers the metrics that are now driven by real prober data in
// service_check_results (written by scripts/prober.ts) instead of by log rows:
//   - uptime                  → % of probes reporting status='up' in the window
//   - website_outage_minutes  → minutes since the last status='up' probe
//   - backend_error_rate      → % of probes reporting status='down' in the window
// Each result carries the originating checkId so applyResult can stamp
// alerts.check_id.

const SERVICE_METRICS = new Set([
  "uptime",
  "website_outage_minutes",
  "backend_error_rate",
]);

async function evaluateServiceRule(rule: AlertRule): Promise<ComputedResult[]> {
  const results: ComputedResult[] = [];
  const windowStart = windowAgo(rule.windowMinutes);

  // 1. Assets matching the rule's asset type (all assets when it has none).
  const assets = rule.assetType
    ? await db
        .select()
        .from(clientAssets)
        .where(eq(clientAssets.assetType, rule.assetType))
    : await db.select().from(clientAssets);

  for (const asset of assets) {
    // 2. Active service_checks configured on this asset.
    const checks = await db
      .select()
      .from(serviceChecks)
      .where(
        and(
          eq(serviceChecks.assetId, asset.id),
          eq(serviceChecks.isActive, true)
        )
      );

    for (const check of checks) {
      if (rule.metric === "uptime") {
        const [totalRow, upRow] = await Promise.all([
          db
            .select({ count: sql<number>`count(*)` })
            .from(serviceCheckResults)
            .where(
              and(
                eq(serviceCheckResults.checkId, check.id),
                gte(serviceCheckResults.checkedAt, windowStart)
              )
            ),
          db
            .select({ count: sql<number>`count(*)` })
            .from(serviceCheckResults)
            .where(
              and(
                eq(serviceCheckResults.checkId, check.id),
                eq(serviceCheckResults.status, "up"),
                gte(serviceCheckResults.checkedAt, windowStart)
              )
            ),
        ]);
        const total = Number(totalRow[0]?.count ?? 0);
        const up = Number(upRow[0]?.count ?? 0);
        // No data in the window reads as healthy (100%), same as the old branch.
        const uptime = total === 0 ? 100 : (up / total) * 100;
        const severity = computeSeverity(
          uptime,
          rule.warningThreshold,
          rule.criticalThreshold,
          "below_is_worse"
        );
        results.push({
          clientId: asset.clientId,
          assetId: asset.id,
          checkId: check.id,
          value: uptime,
          severity,
          message: `"${check.name}" uptime ${formatNumber(uptime)}% over ${rule.windowMinutes}min (${up}/${total} probes up) — ${thresholdText(rule)}`,
        });
      } else if (rule.metric === "website_outage_minutes") {
        const [anyRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(serviceCheckResults)
          .where(eq(serviceCheckResults.checkId, check.id));
        if (Number(anyRow?.count ?? 0) === 0) {
          results.push({
            clientId: asset.clientId,
            assetId: asset.id,
            checkId: check.id,
            value: Infinity,
            severity: "info",
            message: `No probe data yet for "${check.name}"`,
          });
          continue;
        }

        const [lastUp] = await db
          .select({ checkedAt: serviceCheckResults.checkedAt })
          .from(serviceCheckResults)
          .where(
            and(
              eq(serviceCheckResults.checkId, check.id),
              eq(serviceCheckResults.status, "up")
            )
          )
          .orderBy(desc(serviceCheckResults.checkedAt))
          .limit(1);
        const downMinutes = lastUp?.checkedAt
          ? (Date.now() - new Date(lastUp.checkedAt).getTime()) / 6e4
          : Infinity;
        const severity = computeSeverity(
          downMinutes,
          rule.warningThreshold,
          rule.criticalThreshold,
          "above_is_worse"
        );
        results.push({
          clientId: asset.clientId,
          assetId: asset.id,
          checkId: check.id,
          value: downMinutes,
          severity,
          message: `"${check.name}" has had no successful probe for ${formatNumber(downMinutes)}min — ${thresholdText(rule)} (minutes)`,
        });
      } else if (rule.metric === "backend_error_rate") {
        const [totalRow, downRow] = await Promise.all([
          db
            .select({ count: sql<number>`count(*)` })
            .from(serviceCheckResults)
            .where(
              and(
                eq(serviceCheckResults.checkId, check.id),
                gte(serviceCheckResults.checkedAt, windowStart)
              )
            ),
          db
            .select({ count: sql<number>`count(*)` })
            .from(serviceCheckResults)
            .where(
              and(
                eq(serviceCheckResults.checkId, check.id),
                eq(serviceCheckResults.status, "down"),
                gte(serviceCheckResults.checkedAt, windowStart)
              )
            ),
        ]);
        const total = Number(totalRow[0]?.count ?? 0);
        const down = Number(downRow[0]?.count ?? 0);
        const rate = total === 0 ? 0 : (down / total) * 100;
        const severity = computeSeverity(
          rate,
          rule.warningThreshold,
          rule.criticalThreshold,
          "above_is_worse"
        );
        results.push({
          clientId: asset.clientId,
          assetId: asset.id,
          checkId: check.id,
          value: rate,
          severity,
          message: `"${check.name}" error rate ${formatNumber(rate)}% over ${rule.windowMinutes}min (${down}/${total} probes down) — ${thresholdText(rule)}`,
        });
      }
    }
  }

  return results;
}

async function computeForRule(rule: AlertRule): Promise<ComputedResult[]> {
  if (SERVICE_METRICS.has(rule.metric)) {
    return evaluateServiceRule(rule);
  }

  const results: ComputedResult[] = [];

  if (rule.metric === "sync_staleness_hours") {
    const assets = await db
      .select()
      .from(clientAssets)
      .where(eq(clientAssets.assetType, "social"));
    for (const asset of assets) {
      const [lastSync] = await db
        .select({ createdAt: logs.createdAt })
        .from(logs)
        .where(
          and(
            eq(logs.assetId, asset.id),
            eq(logs.source, "social-sync"),
            eq(logs.level, "info")
          )
        )
        .orderBy(desc(logs.createdAt))
        .limit(1);
      const hoursSince = lastSync?.createdAt
        ? (Date.now() - new Date(lastSync.createdAt).getTime()) / 36e5
        : Infinity;
      const severity = computeSeverity(
        hoursSince,
        rule.warningThreshold,
        rule.criticalThreshold,
        "above_is_worse"
      );
      results.push({
        clientId: asset.clientId,
        assetId: asset.id,
        value: hoursSince,
        severity,
        message: `Social sync staleness ${formatNumber(hoursSince)}h — warning threshold ${formatNumber(
          rule.warningThreshold!
        )}h`,
      });
    }
  }

  if (rule.metric === "contract_expiry_days") {
    const assets = await db
      .select()
      .from(clientAssets)
      .where(eq(clientAssets.assetType, "document"));
    for (const asset of assets) {
      const meta = (asset.meta ?? {}) as Record<string, unknown>;
      const expiry = meta.expiryDate
        ? new Date(meta.expiryDate as string)
        : null;
      if (!expiry || isNaN(expiry.getTime())) continue;
      const days = (expiry.getTime() - Date.now()) / 864e5;
      const severity = computeSeverity(
        days,
        rule.warningThreshold,
        rule.criticalThreshold,
        "below_is_worse"
      );
      results.push({
        clientId: asset.clientId,
        assetId: asset.id,
        value: days,
        severity,
        message: `Contract expires in ${formatNumber(days)} days — warning threshold ${formatNumber(
          rule.warningThreshold!
        )} days`,
      });
    }
  }

  if (rule.metric === "record_staleness_days") {
    const assets = await db.select().from(clientAssets);
    for (const asset of assets) {
      const days =
        (Date.now() - new Date(asset.updatedAt).getTime()) / 864e5;
      const severity = computeSeverity(
        days,
        rule.warningThreshold,
        rule.criticalThreshold,
        "above_is_worse"
      );
      results.push({
        clientId: asset.clientId,
        assetId: asset.id,
        value: days,
        severity,
        message: `Asset record staleness ${formatNumber(days)} days — warning threshold ${formatNumber(
          rule.warningThreshold!
        )} days`,
      });
    }
  }

  return results;
}

async function applyResult(rule: AlertRule, result: ComputedResult) {
  const existing = await db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.clientId, result.clientId),
        eq(alerts.ruleId, rule.id),
        result.assetId
          ? eq(alerts.assetId, result.assetId)
          : isNull(alerts.assetId),
        isNull(alerts.resolvedAt)
      )
    )
    .limit(1);

  const openAlert = existing[0];

  if (result.severity === "info") {
    if (openAlert) {
      const update = { resolvedAt: new Date() };
      if (!DRY_RUN) {
        await db.update(alerts).set(update).where(eq(alerts.id, openAlert.id));
      }
      console.log(`[DRY=${DRY_RUN}] Resolved alert ${openAlert.id}`);
    }
    return;
  }

  if (!openAlert) {
    const insert = {
      clientId: result.clientId,
      assetId: result.assetId ?? null,
      checkId: result.checkId ?? null,
      ruleId: rule.id,
      severity: result.severity,
      computedValue: result.value,
      windowMinutes: rule.windowMinutes,
      message: result.message,
      triggeredAt: new Date(),
    };
    if (!DRY_RUN) {
      await db.insert(alerts).values(insert);
    }
    console.log(`[DRY=${DRY_RUN}] Create alert:`, insert);
  } else {
    const update = {
      computedValue: result.value,
      message: result.message,
      severity: result.severity,
      ...(result.checkId ? { checkId: result.checkId } : {}),
    };
    if (!DRY_RUN) {
      await db.update(alerts).set(update).where(eq(alerts.id, openAlert.id));
    }
    console.log(`[DRY=${DRY_RUN}] Update alert ${openAlert.id}:`, update);
  }
}

async function main() {
  const rules = await db
    .select()
    .from(alertRules)
    .where(eq(alertRules.enabled, true));

  console.log(`Running alert engine. Rules: ${rules.length}. Dry run: ${DRY_RUN}`);

  for (const rule of rules) {
    const results = await computeForRule(rule);
    for (const result of results) {
      await applyResult(rule, result);
    }
  }

  console.log("Alert engine finished.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Alert engine failed:", err);
  process.exit(1);
});
