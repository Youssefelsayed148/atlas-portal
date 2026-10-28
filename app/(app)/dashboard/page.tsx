import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/app/lib/db";
import { clients, clientAssets, alerts, logs, alertRules } from "@/app/lib/schema";
import { getCurrentUser } from "@/app/lib/session";
import { eq, and, isNull, desc, sql, gte, lte } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LogsExplorer } from "@/components/dashboard/logs-explorer";
import { NlpQueryBox } from "@/components/dashboard/nlp-query-box";
import {
  SeverityTag,
  alertSeverity,
  severityMeta,
  type Severity,
} from "@/components/severity";
import { Shield, LayoutGrid } from "lucide-react";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function severityRank(severity: string | null) {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  if (severity === "info") return 1;
  return 0;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    sort?: string;
    page?: string;
    level?: string;
    client?: string;
    asset?: string;
    from?: string;
    to?: string;
  }>;
}) {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    redirect("/login");
  }
  if (user.role !== "admin") {
    redirect("/");
  }

  const params = await searchParams;
  const sort = params.sort ?? "severity";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const levelFilter = params.level ?? "";
  const clientFilter = params.client ?? "";
  const assetFilter = params.asset ?? "";
  const fromFilter = params.from ?? "";
  const toFilter = params.to ?? "";

  // KPI strip: open alerts by severity.
  const kpiRows = await db
    .select({ severity: alerts.severity, total: sql<number>`count(*)` })
    .from(alerts)
    .where(isNull(alerts.resolvedAt))
    .groupBy(alerts.severity);

  const critical = kpiRows.find((r) => r.severity === "critical")?.total ?? 0;
  const warning = kpiRows.find((r) => r.severity === "warning")?.total ?? 0;
  const info = kpiRows.find((r) => r.severity === "info")?.total ?? 0;

  // Average uptime from open website uptime alerts.
  const uptimeRows = await db
    .select({ value: sql<number>`avg(${alerts.computedValue})` })
    .from(alerts)
    .innerJoin(alertRules, eq(alerts.ruleId, alertRules.id))
    .where(
      and(
        isNull(alerts.resolvedAt),
        eq(alertRules.metric, "uptime")
      )
    );
  const avgUptime = Number(uptimeRows[0]?.value ?? 100).toFixed(2);

  // Triage table: one row per client with top open alert + proxy metrics.
  const allClients = await db.select().from(clients);

  const openAlerts = await db
    .select()
    .from(alerts)
    .where(isNull(alerts.resolvedAt));

  const errorRateRows = await db
    .select({
      clientId: logs.clientId,
      total: sql<number>`count(*)`,
      errors: sql<number>`sum(case when ${logs.level} = 'error' then 1 else 0 end)`,
    })
    .from(logs)
    .where(
      // Server Component (force-dynamic) intentionally reads the wall clock to
      // define the 1h error-rate window — an intentional impure read.
      // eslint-disable-next-line react-hooks/purity
      gte(logs.createdAt, new Date(Date.now() - 60 * 60 * 1000))
    )
    .groupBy(logs.clientId);

  const errorRateByClient = Object.fromEntries(
    errorRateRows
      .filter((r) => r.clientId != null)
      .map((r) => [
        r.clientId,
        Number(r.total) === 0 ? 0 : (Number(r.errors) / Number(r.total)) * 100,
      ])
  );

  const uptimeRowsByClient = await db
    .select({
      clientId: alerts.clientId,
      minUptime: sql<number>`min(${alerts.computedValue})`,
    })
    .from(alerts)
    .innerJoin(alertRules, eq(alerts.ruleId, alertRules.id))
    .where(and(isNull(alerts.resolvedAt), eq(alertRules.metric, "uptime")))
    .groupBy(alerts.clientId);

  const uptimeByClient = Object.fromEntries(
    uptimeRowsByClient.map((r) => [r.clientId, Number(r.minUptime)])
  );

  const stalenessRows = await db
    .select({
      clientId: alerts.clientId,
      maxStaleness: sql<number>`max(${alerts.computedValue})`,
    })
    .from(alerts)
    .innerJoin(alertRules, eq(alerts.ruleId, alertRules.id))
    .where(
      and(
        isNull(alerts.resolvedAt),
        eq(alertRules.metric, "record_staleness_days")
      )
    )
    .groupBy(alerts.clientId);

  const stalenessByClient = Object.fromEntries(
    stalenessRows.map((r) => [r.clientId, Number(r.maxStaleness)])
  );

  // Triage cell color thresholds, sourced live from alert_rules so they can
  // never drift from what the alert engine actually fires on. The engine reads
  // thresholds from this table (never from a TS constant), so a shared
  // constants file would not be the same source — only a live lookup is.
  // Mapping preserves today's visual behavior: error-rate cell uses the
  // chatbot webhook warning tier (8%), uptime uses the uptime warning tier
  // (99.7%), staleness uses the record-staleness warning tier (60 days).
  // Fallbacks only apply if a rule row is missing entirely (ops error).
  const ruleThresholds = await db
    .select({
      metric: alertRules.metric,
      warningThreshold: alertRules.warningThreshold,
    })
    .from(alertRules);
  const warningThresholdByMetric = Object.fromEntries(
    ruleThresholds
      .filter((r) => r.warningThreshold != null)
      .map((r) => [r.metric, Number(r.warningThreshold)])
  );
  const ERROR_RATE_THRESHOLD = warningThresholdByMetric["webhook_error_rate"] ?? 8;
  const UPTIME_THRESHOLD = warningThresholdByMetric["uptime"] ?? 99.7;
  const STALENESS_THRESHOLD = warningThresholdByMetric["record_staleness_days"] ?? 60;

  const triageRows = allClients.map((client) => {
    const clientAlerts = openAlerts.filter((a) => a.clientId === client.id);
    const mostSevere = clientAlerts.sort(
      (a, b) => severityRank(b.severity) - severityRank(a.severity)
    )[0];
    return {
      client,
      mostSevere,
      errorRate: errorRateByClient[client.id] ?? 0,
      uptime: uptimeByClient[client.id] ?? 100,
      staleness: stalenessByClient[client.id] ?? 0,
    };
  });

  triageRows.sort((a, b) => {
    if (sort === "severity") {
      return severityRank(b.mostSevere?.severity ?? null) - severityRank(a.mostSevere?.severity ?? null);
    }
    if (sort === "error_rate") return b.errorRate - a.errorRate;
    if (sort === "uptime") return a.uptime - b.uptime;
    if (sort === "staleness") return b.staleness - a.staleness;
    return 0;
  });

  // Logs explorer: paginated + filtered.
  const clientList = await db.select().from(clients).orderBy(clients.name);

  const assetList = await db
    .select({
      id: clientAssets.id,
      name: clientAssets.name,
      clientName: clients.name,
    })
    .from(clientAssets)
    .leftJoin(clients, eq(clientAssets.clientId, clients.id))
    .orderBy(clients.name, clientAssets.name);

  const where = [];
  if (levelFilter)
    where.push(eq(logs.level, levelFilter as typeof logs.$inferSelect.level));
  if (clientFilter) where.push(eq(logs.clientId, clientFilter));
  if (assetFilter) where.push(eq(logs.assetId, assetFilter));
  // Date-range filters: interpreted as local calendar days (inclusive).
  const fromDate = fromFilter ? new Date(`${fromFilter}T00:00:00`) : null;
  const toDate = toFilter ? new Date(`${toFilter}T23:59:59.999`) : null;
  if (fromDate && !isNaN(fromDate.getTime())) {
    where.push(gte(logs.createdAt, fromDate));
  }
  if (toDate && !isNaN(toDate.getTime())) {
    where.push(lte(logs.createdAt, toDate));
  }

  const totalLogsRows = await db
    .select({ total: sql<number>`count(*)` })
    .from(logs)
    .where(and(...where));
  const totalLogs = Number(totalLogsRows[0]?.total ?? 0);

  const totalPages = Math.ceil(totalLogs / PAGE_SIZE);
  // Clamp both ends: never below 1, never past the last page.
  const clampedPage = Math.min(page, Math.max(1, totalPages));

  const logRows = await db
    .select()
    .from(logs)
    .where(and(...where))
    .orderBy(desc(logs.createdAt))
    .limit(PAGE_SIZE)
    .offset((clampedPage - 1) * PAGE_SIZE);

  // Clients with no open alert of any severity.
  const healthyClients = triageRows.filter((row) => !row.mostSevere).length;

  return (
    <main className="flex-1 p-6 text-foreground">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header bar */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="logo-mark flex size-8 shrink-0 items-center justify-center rounded-lg">
              <span className="text-sm font-bold text-[#06111F]">A</span>
            </div>
            <div>
              <div className="text-[15px] font-semibold tracking-tight">
                Admin Insights
              </div>
              <div className="text-[11.5px] text-muted-foreground">
                {allClients.length} client{allClients.length === 1 ? "" : "s"}{" "}
                monitored · alerts computed from live logs
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-[13px] font-medium">
            <Shield className="size-3.5 text-primary" aria-hidden /> Admin view
          </div>
        </header>

        {/* KPI strip */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard title="Critical alerts" value={critical} severity="critical" />
          <KpiCard title="Warning alerts" value={warning} severity="warning" />
          <KpiCard title="Info alerts" value={info} severity="info" />
          <KpiCard title="Healthy clients" value={healthyClients} severity="ok" />
          <KpiCard title="Avg uptime" value={`${avgUptime}%`} accent="#22D3EE" />
        </div>

        {/* Triage table */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayoutGrid className="size-3.5 text-primary" aria-hidden />
              Client triage ({triageRows.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap gap-2">
              <SortLink current={sort} value="severity" label="Severity" />
              <SortLink current={sort} value="error_rate" label="Error rate" />
              <SortLink current={sort} value="uptime" label="Uptime" />
              <SortLink current={sort} value="staleness" label="Staleness" />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Error rate (1h)</TableHead>
                  <TableHead className="text-right">Uptime</TableHead>
                  <TableHead className="text-right">Staleness (days)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {triageRows.map((row) => (
                  <TableRow key={row.client.id} className="relative cursor-pointer">
                    <TableCell>
                      {/* Stretched link: the ::after overlay makes the whole row a
                          click target while keeping a real anchor for middle-click,
                          open-in-new-tab and keyboard navigation. */}
                      <Link
                        href={`/clients/${row.client.id}`}
                        className="font-medium hover:underline after:absolute after:inset-0 after:content-['']"
                      >
                        {row.client.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <SeverityTag
                        severity={alertSeverity(row.mostSevere?.severity)}
                      />
                    </TableCell>
                    <TableCell
                      className="text-right font-medium"
                      style={{
                        color:
                          row.errorRate > ERROR_RATE_THRESHOLD
                            ? severityMeta.critical.hex
                            : "var(--foreground-secondary)",
                      }}
                    >
                      {row.errorRate.toFixed(2)}%
                    </TableCell>
                    <TableCell
                      className="text-right font-medium"
                      style={{
                        color:
                          row.uptime < UPTIME_THRESHOLD
                            ? severityMeta.warning.hex
                            : "var(--foreground-secondary)",
                      }}
                    >
                      {row.uptime.toFixed(2)}%
                    </TableCell>
                    <TableCell
                      className="text-right"
                      style={{
                        color:
                          row.staleness > STALENESS_THRESHOLD
                            ? severityMeta.info.hex
                            : "var(--muted-foreground)",
                        fontWeight: row.staleness > STALENESS_THRESHOLD ? 600 : 400,
                      }}
                    >
                      {row.staleness.toFixed(1)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* NLP query box */}
        <NlpQueryBox />

        {/* Logs explorer */}
        <LogsExplorer
          logRows={logRows}
          clientList={clientList}
          assetList={assetList}
          page={clampedPage}
          totalPages={totalPages}
          levelFilter={levelFilter}
          clientFilter={clientFilter}
          assetFilter={assetFilter}
          fromFilter={fromFilter}
          toFilter={toFilter}
        />
      </div>
    </main>
  );
}

function KpiCard({
  title,
  value,
  severity,
  accent,
}: {
  title: string;
  value: string | number;
  severity?: Severity;
  accent?: string;
}) {
  const hex = severity ? severityMeta[severity].hex : (accent ?? "#22D3EE");
  return (
    <Card className="border-border bg-card">
      <CardContent className="pt-6">
        <p className="text-[11px] text-muted-foreground">{title}</p>
        <p
          className="text-[24px] font-semibold tracking-tight"
          style={{ color: hex, textShadow: `0 0 24px ${hex}33` }}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function SortLink({
  current,
  value,
  label,
}: {
  current: string;
  value: string;
  label: string;
}) {
  return (
    <Link
      href={`/dashboard?sort=${value}`}
      className={`rounded-md border px-3 py-1 text-sm ${
        current === value
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-secondary text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}

