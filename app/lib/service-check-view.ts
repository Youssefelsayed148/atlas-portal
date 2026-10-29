import type { clientAssets, serviceChecks, serviceCheckResults } from "./schema";

type CheckRow = typeof serviceChecks.$inferSelect;
type AssetRow = typeof clientAssets.$inferSelect;
type ResultRow = typeof serviceCheckResults.$inferSelect;

/** Plain, serialisable shape handed to the client component. */
export type ServiceCheckView = {
  id: string;
  assetId: string;
  assetName: string;
  checkType: CheckRow["checkType"];
  name: string;
  /** Raw target, only used to prefill the edit form (admin/developer only). */
  target: string;
  /** Safe-to-display target: no passwords, no query strings. */
  displayTarget: string;
  config: Record<string, unknown>;
  intervalSeconds: number;
  isActive: boolean;
  latest: {
    status: ResultRow["status"];
    latencyMs: number | null;
    statusCode: number | null;
    errorMessage: string | null;
    checkedAt: string;
  } | null;
};

/** Hide credentials and tokens when a target is shown in a list. */
export function maskTarget(checkType: CheckRow["checkType"], target: string): string {
  if (checkType === "webhook") return target;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return checkType === "db" ? "(hidden)" : target;
  }
  if (checkType === "db") {
    const user = url.username ? `${url.username}:***@` : "";
    return `${url.protocol}//${user}${url.host}${url.pathname}`;
  }
  return `${url.origin}${url.pathname}${url.search ? "?…" : ""}`;
}

export function toServiceCheckView(
  check: CheckRow,
  asset: AssetRow,
  latest: ResultRow | null
): ServiceCheckView {
  const config =
    check.config && typeof check.config === "object" && !Array.isArray(check.config)
      ? (check.config as Record<string, unknown>)
      : {};
  return {
    id: check.id,
    assetId: asset.id,
    assetName: asset.name,
    checkType: check.checkType,
    name: check.name,
    target: check.target,
    displayTarget: maskTarget(check.checkType, check.target),
    config,
    intervalSeconds: check.intervalSeconds,
    isActive: check.isActive,
    latest: latest
      ? {
          status: latest.status,
          latencyMs: latest.latencyMs,
          statusCode: latest.statusCode,
          errorMessage: latest.errorMessage,
          checkedAt: new Date(latest.checkedAt).toISOString(),
        }
      : null,
  };
}
