import { db } from "@/app/lib/db";
import {
  clients,
  clientAssets,
  activityLog,
  alerts,
  logs,
  serviceChecks,
  serviceCheckResults,
} from "@/app/lib/schema";
import { eq, desc, and, isNull } from "drizzle-orm";
import { toServiceCheckView } from "@/app/lib/service-check-view";
import {
  ServiceChecksPanel,
  type CheckableAsset,
} from "@/components/clients/service-checks";
import { SeverityTag, LogLevelBadge, type Severity } from "@/components/severity";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AssetForm } from "@/components/clients/asset-form";
import { AssetList } from "@/components/clients/asset-list";
import { ClientEditForm } from "@/components/clients/client-edit-form";
import { Section } from "@/components/clients/section";
import { getCurrentUser } from "@/app/lib/session";
import {
  roleCanViewSection,
  roleCanManageAssetType,
  roleCanManageClients,
} from "@/app/lib/roles";
import {
  Globe,
  Smartphone,
  Bot,
  FileText,
  Share2,
  Activity,
} from "lucide-react";

export const dynamic = "force-dynamic";

const sectionIcons: Record<string, React.ReactNode> = {
  website: <Globe className="size-5 text-primary" />,
  apps: <Smartphone className="size-5 text-primary" />,
  chatbot: <Bot className="size-5 text-primary" />,
  documents: <FileText className="size-5 text-primary" />,
  social: <Share2 className="size-5 text-primary" />,
  health: <Activity className="size-5 text-primary" />,
};

const sectionTitles: Record<string, string> = {
  website: "Website",
  apps: "Apps",
  chatbot: "Chatbot",
  documents: "Documents",
  social: "Social",
  health: "Health / Logs",
};

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();

  const [client] = await db.select().from(clients).where(eq(clients.id, id));
  if (!client) notFound();

  const assets = await db
    .select()
    .from(clientAssets)
    .where(eq(clientAssets.clientId, id))
    .orderBy(desc(clientAssets.createdAt));

  const activities = await db
    .select()
    .from(activityLog)
    .where(eq(activityLog.clientId, id))
    .orderBy(desc(activityLog.createdAt))
    .limit(50);

  // Drives the health icon beside the client name.
  const openAlerts = await db
    .select({ severity: alerts.severity })
    .from(alerts)
    .where(and(eq(alerts.clientId, id), isNull(alerts.resolvedAt)));

  // Recent logs for the Health / Logs section (admin + developer only).
  const recentLogs = await db
    .select()
    .from(logs)
    .where(eq(logs.clientId, id))
    .orderBy(desc(logs.createdAt))
    .limit(10);

  // Service checks (admin + developer only, same gate as the Health section).
  const canViewChecks = roleCanViewSection(user.role, "health");
  const checkRows = canViewChecks
    ? await db
        .select({ check: serviceChecks, asset: clientAssets })
        .from(serviceChecks)
        .innerJoin(clientAssets, eq(serviceChecks.assetId, clientAssets.id))
        .where(eq(clientAssets.clientId, id))
        .orderBy(desc(serviceChecks.createdAt))
    : [];
  const checkViews = await Promise.all(
    checkRows.map(async ({ check, asset }) => {
      const [latest] = await db
        .select()
        .from(serviceCheckResults)
        .where(eq(serviceCheckResults.checkId, check.id))
        .orderBy(desc(serviceCheckResults.checkedAt))
        .limit(1);
      return toServiceCheckView(check, asset, latest ?? null);
    })
  );
  const checkableAssets: CheckableAsset[] = assets
    .filter(
      (a) =>
        a.status !== "archived" &&
        (a.assetType === "website" ||
          a.assetType === "app" ||
          a.assetType === "chatbot") &&
        roleCanManageAssetType(user.role, a.assetType)
    )
    .map((a) => {
      const meta = (a.meta ?? {}) as Record<string, unknown>;
      return {
        id: a.id,
        name: a.name,
        assetType: a.assetType,
        url:
          a.assetType === "website" && typeof meta.url === "string"
            ? meta.url
            : undefined,
      };
    });

  const clientHealth: Severity = openAlerts.some(
    (a) => a.severity === "critical"
  )
    ? "critical"
    : openAlerts.some((a) => a.severity === "warning")
      ? "warning"
      : openAlerts.some((a) => a.severity === "info")
        ? "info"
        : "ok";

  const assetsByType = {
    website: assets.filter((a) => a.assetType === "website"),
    app: assets.filter((a) => a.assetType === "app"),
    chatbot: assets.filter((a) => a.assetType === "chatbot"),
    document: assets.filter((a) => a.assetType === "document"),
    social: assets.filter((a) => a.assetType === "social"),
  };

  const sectionOrder = [
    "website",
    "apps",
    "chatbot",
    "documents",
    "social",
    "health",
  ] as const;

  const hiddenWhenRestricted = user.role === "legal";

  const manageableAssetTypes = (
    ["website", "app", "chatbot", "document", "social"] as const
  ).filter((type) => roleCanManageAssetType(user.role, type));

  return (
    <main className="flex-1 p-6 text-foreground">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div
                className="flex size-12 items-center justify-center rounded-lg font-bold text-lg"
                style={{ backgroundColor: client.color ?? "#0E1826", color: "#E7ECF5" }}
              >
                {client.initials ?? client.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold">{client.name}</h1>
                  <SeverityTag severity={clientHealth} />
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Badge variant="outline">{client.tier}</Badge>
                  <Badge>{client.status}</Badge>
                </div>
              </div>
            </div>
          </div>
          {roleCanManageClients(user.role) && <ClientEditForm client={client} />}
        </div>

        {/* Sections */}
        <div className="grid gap-6 lg:grid-cols-2">
          {sectionOrder.map((section) => {
            const visible = roleCanViewSection(user.role, section);
            const typeKey =
              section === "apps"
                ? "app"
                : section === "documents"
                  ? "document"
                  : section === "health"
                    ? null
                    : section;
            return (
              <Section
                key={section}
                title={sectionTitles[section]}
                icon={sectionIcons[section]}
                visible={visible}
                hiddenWhenRestricted={hiddenWhenRestricted}
              >
                {section === "health" ? (
                  <HealthPanel
                    openAlertCount={openAlerts.length}
                    recentLogs={recentLogs}
                  />
                ) : (
                  <AssetList
                    clientId={client.id}
                    assets={typeKey ? assetsByType[typeKey] : []}
                    manageableAssetTypes={manageableAssetTypes}
                  />
                )}
              </Section>
            );
          })}
        </div>

        {/* Service checks — what the prober watches for this client */}
        {canViewChecks && (
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-5 text-primary" />
                Service checks
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ServiceChecksPanel
                checks={checkViews}
                assets={checkableAssets}
                canManage={roleCanManageClients(user.role)}
              />
            </CardContent>
          </Card>
        )}

        {/* Activity log — visible to all roles */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>Activity log</CardTitle>
          </CardHeader>
          <CardContent>
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ul className="space-y-3">
                {activities.map((activity) => (
                  <li
                    key={activity.id}
                    className="flex items-start justify-between border-b border-border pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium text-sm">{activity.action}</p>
                      {activity.detail && (
                        <p className="text-sm text-muted-foreground">
                          {activity.detail}
                        </p>
                      )}
                    </div>
                    <time className="text-xs text-muted-foreground">
                      {activity.createdAt
                        ? new Date(activity.createdAt).toLocaleString()
                        : "—"}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Add asset — only allowed types */}
        {manageableAssetTypes.length > 0 && (
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle>Add asset</CardTitle>
            </CardHeader>
            <CardContent>
              <AssetForm
                clientId={client.id}
                allowedAssetTypes={manageableAssetTypes}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

/** Health / Logs panel — rendered inside the role-gated health section. */
function HealthPanel({
  openAlertCount,
  recentLogs,
}: {
  openAlertCount: number;
  recentLogs: (typeof logs.$inferSelect)[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Open alerts:</span>
        <span className="font-medium">{openAlertCount}</span>
      </div>
      {recentLogs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No recent logs for this client.
        </p>
      ) : (
        <ul className="space-y-2">
          {recentLogs.map((log) => (
            <li
              key={log.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-secondary p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <LogLevelBadge level={log.level} />
                  <span className="text-[11.5px] text-muted-foreground">
                    {log.source}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] text-foreground-secondary">
                  {log.message}
                </p>
              </div>
              <time className="shrink-0 text-[11px] text-muted-foreground">
                {log.createdAt
                  ? new Date(log.createdAt).toLocaleString()
                  : "—"}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

