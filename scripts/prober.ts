import "./env";
import { db } from "../app/lib/db";
import { serviceChecks, serviceCheckResults } from "../app/lib/schema";
import { eq, desc } from "drizzle-orm";
import { Client } from "pg";

const DRY_RUN = process.argv.includes("--dry-run");

type ServiceCheck = typeof serviceChecks.$inferSelect;
type ServiceCheckResult = typeof serviceCheckResults.$inferSelect;

type CheckStatus = "up" | "down" | "degraded";

interface CheckResult {
  status: CheckStatus;
  latencyMs?: number;
  statusCode?: number;
  errorMessage?: string;
  rawResponse?: Record<string, unknown> | null;
}

/** Shape of serviceChecks.config (jsonb). Every field is optional — a check
 *  with an empty config still runs with the documented defaults. */
interface CheckConfig {
  method?: string;
  /** [min, max] inclusive HTTP status range. Defaults to [200, 299]. */
  expectedStatus?: [number, number];
  bodyContains?: string;
  latencyWarningMs?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Dot-path into the JSON response body, e.g. "data.status". */
  expectedField?: string;
  expectedValue?: unknown;
  healthQuery?: string;
  staleAfterMinutes?: number;
}

function getConfig(check: ServiceCheck): CheckConfig {
  const c = check.config;
  return c && typeof c === "object" ? (c as CheckConfig) : {};
}

function errText(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return "Request timed out";
    }
    return err.message;
  }
  return String(err);
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc != null && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a != null && b != null && typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

// ------------------------------------------------------------------
// Shared HTTP probe (used by the http and api runners)
// ------------------------------------------------------------------

interface HttpProbe {
  latencyMs: number;
  statusCode: number;
  bodyText: string;
  networkError?: string;
}

async function performHttpProbe(
  target: string,
  opts: { method: string; headers?: Record<string, string>; timeoutMs: number }
): Promise<HttpProbe> {
  const start = Date.now();
  try {
    const res = await fetch(target, {
      method: opts.method,
      headers: opts.headers,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    const bodyText = await res.text().catch(() => "");
    return { latencyMs: Date.now() - start, statusCode: res.status, bodyText };
  } catch (err) {
    return {
      latencyMs: Date.now() - start,
      statusCode: 0,
      bodyText: "",
      networkError: errText(err),
    };
  }
}

// ------------------------------------------------------------------
// Runners — one per check_type
// ------------------------------------------------------------------

export async function runHttpCheck(check: ServiceCheck): Promise<CheckResult> {
  const config = getConfig(check);
  const method = config.method ?? "GET";
  const [minStatus, maxStatus] = config.expectedStatus ?? [200, 299];
  const timeoutMs = config.timeoutMs ?? 15000;

  const probe = await performHttpProbe(check.target, { method, timeoutMs });
  if (probe.networkError) {
    return {
      status: "down",
      latencyMs: probe.latencyMs,
      errorMessage: probe.networkError,
    };
  }

  const { latencyMs, statusCode, bodyText } = probe;

  if (statusCode < minStatus || statusCode > maxStatus) {
    return {
      status: "down",
      latencyMs,
      statusCode,
      errorMessage: `HTTP ${statusCode} outside expected ${minStatus}-${maxStatus}`,
    };
  }
  if (config.bodyContains && !bodyText.includes(config.bodyContains)) {
    return {
      status: "down",
      latencyMs,
      statusCode,
      errorMessage: `Response body missing expected substring "${config.bodyContains}"`,
    };
  }
  if (config.latencyWarningMs != null && latencyMs > config.latencyWarningMs) {
    return {
      status: "degraded",
      latencyMs,
      statusCode,
      errorMessage: `Latency ${latencyMs}ms exceeds warning threshold ${config.latencyWarningMs}ms`,
    };
  }
  return { status: "up", latencyMs, statusCode };
}

export async function runApiCheck(check: ServiceCheck): Promise<CheckResult> {
  const config = getConfig(check);
  const method = config.method ?? "GET";
  const [minStatus, maxStatus] = config.expectedStatus ?? [200, 299];
  const timeoutMs = config.timeoutMs ?? 15000;

  const probe = await performHttpProbe(check.target, {
    method,
    headers: config.headers,
    timeoutMs,
  });
  if (probe.networkError) {
    return {
      status: "down",
      latencyMs: probe.latencyMs,
      errorMessage: probe.networkError,
    };
  }

  const { latencyMs, statusCode, bodyText } = probe;

  if (statusCode < minStatus || statusCode > maxStatus) {
    return {
      status: "down",
      latencyMs,
      statusCode,
      errorMessage: `HTTP ${statusCode} outside expected ${minStatus}-${maxStatus}`,
    };
  }
  if (config.bodyContains && !bodyText.includes(config.bodyContains)) {
    return {
      status: "down",
      latencyMs,
      statusCode,
      errorMessage: `Response body missing expected substring "${config.bodyContains}"`,
    };
  }

  let parsed: unknown = null;
  if (config.expectedField != null) {
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return {
        status: "down",
        latencyMs,
        statusCode,
        errorMessage: `Response body is not valid JSON (expectedField "${config.expectedField}" configured)`,
      };
    }
    const actual = getPath(parsed, config.expectedField);
    if (!valuesEqual(actual, config.expectedValue)) {
      return {
        status: "down",
        latencyMs,
        statusCode,
        errorMessage: `Field "${config.expectedField}" = ${JSON.stringify(
          actual
        )}, expected ${JSON.stringify(config.expectedValue)}`,
      };
    }
  }

  if (config.latencyWarningMs != null && latencyMs > config.latencyWarningMs) {
    return {
      status: "degraded",
      latencyMs,
      statusCode,
      errorMessage: `Latency ${latencyMs}ms exceeds warning threshold ${config.latencyWarningMs}ms`,
    };
  }
  return {
    status: "up",
    latencyMs,
    statusCode,
    rawResponse:
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : undefined,
  };
}

/** Turn a raw pg/driver error into a short, human class + the real message. */
function classifyDbError(err: unknown): string {
  const raw = errText(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  const lower = raw.toLowerCase();

  if (code === "ECONNREFUSED" || lower.includes("econnrefused")) {
    return `Connection refused: ${raw}`;
  }
  if (
    code === "ETIMEDOUT" ||
    lower.includes("timeout") ||
    lower.includes("timed out")
  ) {
    return `Connection or query timed out: ${raw}`;
  }
  if (code === "28P01" || lower.includes("password authentication failed")) {
    return `Authentication failed: ${raw}`;
  }
  if (code === "3D000" || lower.includes("does not exist")) {
    return `Database does not exist: ${raw}`;
  }
  if (code === "ENOTFOUND" || lower.includes("getaddrinfo")) {
    return `Host not found: ${raw}`;
  }
  return raw;
}

export async function runDbCheck(check: ServiceCheck): Promise<CheckResult> {
  const config = getConfig(check);
  const query = config.healthQuery ?? "SELECT 1";
  const timeoutMs = config.timeoutMs ?? 10000;

  const client = new Client({
    connectionString: check.target,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
  });

  const start = Date.now();
  try {
    await client.connect();
    const connectMs = Date.now() - start;

    const queryStart = Date.now();
    await client.query(query);
    const queryMs = Date.now() - queryStart;

    const latencyMs = Date.now() - start;
    const rawResponse = { connectMs, queryMs, query };

    if (config.latencyWarningMs != null && latencyMs > config.latencyWarningMs) {
      return {
        status: "degraded",
        latencyMs,
        errorMessage: `DB latency ${latencyMs}ms exceeds warning threshold ${config.latencyWarningMs}ms`,
        rawResponse,
      };
    }
    return { status: "up", latencyMs, rawResponse };
  } catch (err) {
    return {
      status: "down",
      latencyMs: Date.now() - start,
      errorMessage: classifyDbError(err),
    };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Passive staleness read. It performs NO outbound call and — see main() — its
 * result is never written back as a service_check_results row: doing so would
 * refresh checked_at every cycle and staleAfterMinutes could never fire.
 *
 * NOTE / future integration point: nothing in the current codebase writes real
 * delivery rows for webhook checks yet. Whatever service receives the webhook
 * must insert its own service_check_results row (check_id + status='up', plus
 * latency/raw as available) on each delivery. This runner only reads the most
 * recent such row and decides up/down based on its age.
 */
export async function runWebhookCheck(
  check: ServiceCheck
): Promise<CheckResult> {
  const config = getConfig(check);
  const staleAfterMinutes = config.staleAfterMinutes ?? 60;
  const last = await latestResult(check.id);

  if (!last) {
    return {
      status: "down",
      errorMessage: "No prior check result recorded yet",
    };
  }

  const ageMinutes =
    (Date.now() - new Date(last.checkedAt).getTime()) / 60000;

  if (ageMinutes > staleAfterMinutes) {
    return {
      status: "down",
      latencyMs: last.latencyMs ?? undefined,
      statusCode: last.statusCode ?? undefined,
      errorMessage: `Last result is ${ageMinutes.toFixed(
        1
      )}min old — stale after ${staleAfterMinutes}min`,
    };
  }

  // Not stale: pass through whatever the last recorded result reported. This
  // check type re-evaluates staleness only; it does not perform an outbound probe.
  return {
    status: last.status,
    latencyMs: last.latencyMs ?? undefined,
    statusCode: last.statusCode ?? undefined,
    errorMessage: last.errorMessage ?? undefined,
    rawResponse:
      (last.rawResponse as Record<string, unknown> | null) ?? undefined,
  };
}

// ------------------------------------------------------------------
// Dispatcher
// ------------------------------------------------------------------

export async function runCheck(check: ServiceCheck): Promise<CheckResult> {
  switch (check.checkType) {
    case "http":
      return runHttpCheck(check);
    case "api":
      return runApiCheck(check);
    case "db":
      return runDbCheck(check);
    case "webhook":
      return runWebhookCheck(check);
    default: {
      // Unreachable while check_type is the enum, but keep it explicit rather
      // than fabricating a status for an unknown type.
      const unknownType: string = check.checkType;
      return {
        status: "down",
        errorMessage: `Unknown check type "${unknownType}"`,
      };
    }
  }
}

// ------------------------------------------------------------------
// Runner
// ------------------------------------------------------------------

async function latestResult(
  checkId: string
): Promise<ServiceCheckResult | null> {
  const [row] = await db
    .select()
    .from(serviceCheckResults)
    .where(eq(serviceCheckResults.checkId, checkId))
    .orderBy(desc(serviceCheckResults.checkedAt))
    .limit(1);
  return row ?? null;
}

function formatLine(check: ServiceCheck, result: CheckResult): string {
  const latencyPart =
    result.latencyMs != null ? ` (${result.latencyMs} ms)` : "";
  let line = `[${check.checkType}] ${check.name} -> ${result.status}${latencyPart}`;
  if (result.status !== "up" && result.errorMessage) {
    line += ` — ${result.errorMessage}`;
  }
  return line;
}

async function main() {
  const checks = await db
    .select()
    .from(serviceChecks)
    .where(eq(serviceChecks.isActive, true));

  if (checks.length === 0) {
    console.log("No active checks.");
    process.exit(0);
  }

  console.log(
    `Running prober. Active checks: ${checks.length}. Dry run: ${DRY_RUN}`
  );

  let ran = 0;
  let skipped = 0;

  for (const check of checks) {
    const last = await latestResult(check.id);

    // Self-gate on each check's own interval_seconds. A short scheduler cadence
    // is therefore safe. --dry-run ignores the gate and runs everything.
    if (!DRY_RUN && last) {
      const ageSeconds =
        (Date.now() - new Date(last.checkedAt).getTime()) / 1000;
      if (ageSeconds < check.intervalSeconds) {
        skipped++;
        console.log(
          `[${check.checkType}] ${check.name} -> skipped (next due in ${Math.ceil(
            check.intervalSeconds - ageSeconds
          )}s)`
        );
        continue;
      }
    }

    let result: CheckResult;
    try {
      result = await runCheck(check);
    } catch (err) {
      // A runner threw unexpectedly. Record the real error as a 'down' result —
      // never swallow it or invent a value.
      result = {
        status: "down",
        errorMessage: `Prober error: ${errText(err)}`,
      };
    }

    ran++;
    console.log(formatLine(check, result));

    // Webhook checks never originate a row — they are a passive staleness read
    // over externally-written delivery rows. Inserting a pass-through row here
    // would keep refreshing checked_at and staleAfterMinutes could never fire.
    if (!DRY_RUN && check.checkType !== "webhook") {
      await db.insert(serviceCheckResults).values({
        checkId: check.id,
        status: result.status,
        latencyMs: result.latencyMs ?? null,
        statusCode: result.statusCode ?? null,
        errorMessage: result.errorMessage ?? null,
        rawResponse: result.rawResponse ?? null,
      });
    }
  }

  console.log(
    `Prober finished. Ran: ${ran}, skipped: ${skipped}${
      DRY_RUN ? " (dry run — no rows written)" : ""
    }.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Prober failed:", err);
  process.exit(1);
});
