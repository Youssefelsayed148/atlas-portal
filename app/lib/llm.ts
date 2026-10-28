import { db } from "./db";
import {
  nlpQueries,
  alerts,
  logs,
  clients,
  clientAssets,
  serviceChecks,
  serviceCheckResults,
} from "./schema";
import { eq, and, gte, desc, ilike } from "drizzle-orm";

const API_KEY = process.env.LLM_API_KEY;
const BASE_URL = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
const MODEL = process.env.LLM_MODEL ?? "gpt-4o-mini";

interface ParsedFilter {
  intent?: "alerts" | "logs" | "clients" | "assets" | "services";
  severity?: "info" | "warning" | "critical";
  assetType?: "website" | "app" | "chatbot" | "document" | "social";
  clientName?: string;
  timeRangeHours?: number;
  sort?: "newest" | "oldest";
}

async function llmChat(
  system: string,
  user: string,
  options: { json?: boolean } = {}
): Promise<string> {
  if (!API_KEY) {
    throw new Error("LLM_API_KEY is not configured");
  }

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM request failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content");
  return content;
}

const parserSystem = `You are a strict parser for an internal client-portal query assistant.
Your job is to convert the user's natural-language question into a JSON filter object.
Return ONLY a JSON object matching this TypeScript type — no markdown, no explanation:

{
  "intent": "alerts" | "logs" | "clients" | "assets" | "services",
  "severity": "info" | "warning" | "critical" | undefined,
  "assetType": "website" | "app" | "chatbot" | "document" | "social" | undefined,
  "clientName": string | undefined,
  "timeRangeHours": number | undefined,
  "sort": "newest" | "oldest" | undefined
}

Rules:
- intent defaults to "alerts" when unclear.
- intent "services" for questions about whether a specific service/check is healthy, its latest status, latency, or uptime.
- severity from words like critical, warning, error, info.
- assetType from website, app, chatbot, document, social.
- clientName when a client name is mentioned (even partial).
- timeRangeHours from phrases like "last 24 hours", "past week" (use 168), "today" (use 24).
- sort "newest" for recent/recently, "oldest" otherwise.
- Do not invent values. Use undefined for missing fields.`;

async function parseQuestion(question: string): Promise<ParsedFilter> {
  const raw = await llmChat(parserSystem, question, { json: true });
  const parsed = JSON.parse(raw) as ParsedFilter;
  return parsed;
}

// ------------------------------------------------------------------
// Summary grounding + structural validation
// ------------------------------------------------------------------
// The summarizer is a black box, so "don't invent numbers" must be enforced,
// not merely requested. We (a) give it exact aggregate statistics plus a
// bounded row sample, and (b) verify afterwards that every number/date token
// in its sentence is grounded in the data that was actually retrieved. Any
// ungrounded token discards the summary in favour of a deterministic
// fallback built straight from the rows.

const summarizerSystem = `You are a terse data summarizer. You will be given a JSON object with (a) exact aggregate statistics and (b) a sample of the rows retrieved from the database for a user's question.
Write exactly ONE sentence describing the records.
Rules:
- Use ONLY numbers, counts, severity names, client names, and dates that appear verbatim in the aggregates or in the sample rows you are given. Never round, estimate, or invent any figure.
- Prefer the aggregate values (total count, per-severity counts, min/max/avg, client names) for any quantitative claim.
- If there are no matching records, say there are no matching records.`;

/** Every numeric value present anywhere in the retrieved rows (recursive). */
function collectRowNumbers(rows: unknown[]): number[] {
  const out: number[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "number") {
      out.push(v);
    } else if (
      typeof v === "string" &&
      v.trim() !== "" &&
      !Number.isNaN(Number(v))
    ) {
      out.push(Number(v));
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v !== null && typeof v === "object") {
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  };
  rows.forEach(walk);
  return out;
}

/** YYYY-MM-DD substrings found in the retrieved rows (dates / ISO timestamps). */
function collectRowDates(rows: unknown[]): string[] {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      const m = v.match(/\d{4}-\d{2}-\d{2}/);
      if (m) out.add(m[0]);
    } else if (v instanceof Date) {
      out.add(v.toISOString().slice(0, 10));
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v !== null && typeof v === "object") {
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  };
  rows.forEach(walk);
  return [...out];
}

interface SummaryContext {
  /** Compact JSON sent to the LLM: exact aggregates + a bounded row sample. */
  summaryInput: string;
  /** Every number grounded in the data (rows + aggregates + time window). */
  evidenceNumbers: number[];
  /** Every date (YYYY-MM-DD) grounded in the data (rows + today). */
  evidenceDates: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildSummaryContext(
  rows: unknown[],
  intent: ParsedFilter["intent"],
  timeRangeHours?: number
): SummaryContext {
  const count = rows.length;

  // Per-severity / per-level / per-check-status counts. `latestStatus` covers
  // the "services" intent (up / down / degraded).
  const severityCounts: Record<string, number> = {};
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const key = r.severity ?? r.level ?? r.latestStatus;
    if (typeof key === "string") {
      severityCounts[key] = (severityCounts[key] ?? 0) + 1;
    }
  }

  const computed = rows
    .map((r) => (r as Record<string, unknown>).computedValue)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const min = computed.length ? Math.min(...computed) : undefined;
  const max = computed.length ? Math.max(...computed) : undefined;
  const avg = computed.length
    ? computed.reduce((a, b) => a + b, 0) / computed.length
    : undefined;

  const clientNames = [
    ...new Set(
      rows
        .map((r) => (r as Record<string, unknown>).clientName)
        .filter((n): n is string => typeof n === "string")
    ),
  ];

  const aggregates: Record<string, unknown> = {
    totalCount: count,
  };
  if (Object.keys(severityCounts).length > 0) aggregates.bySeverity = severityCounts;
  if (min !== undefined) aggregates.computedValueMin = round2(min);
  if (max !== undefined) aggregates.computedValueMax = round2(max);
  if (avg !== undefined) aggregates.computedValueAvg = round2(avg);
  if (clientNames.length > 0) aggregates.clientNames = clientNames;

  // Bounded sample keeps the prompt cheap. The evidence set below is built
  // from EVERY retrieved row, so the cap cannot let the model invent a figure
  // that exists only beyond the sample.
  const sampleRows = rows.slice(0, 10);

  const summaryInput = JSON.stringify({ aggregates, sampleRows }, null, 2);

  // Service-check rows ("services" intent): pull latencyMs / statusCode
  // (numbers) and checkedAt (date) into the evidence sets explicitly. The
  // recursive collectors below already reach them for a flat row shape; this
  // keeps the grounding robust if the row shape ever nests these fields, and
  // makes it obvious these values are legitimately grounded — not a relaxation.
  const serviceNumberEvidence: number[] = [];
  const serviceDateEvidence: string[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    if (typeof r.latencyMs === "number") serviceNumberEvidence.push(r.latencyMs);
    if (typeof r.statusCode === "number") serviceNumberEvidence.push(r.statusCode);
    const checkedAt = r.checkedAt;
    if (checkedAt instanceof Date) {
      serviceDateEvidence.push(checkedAt.toISOString().slice(0, 10));
    } else if (typeof checkedAt === "string") {
      const m = checkedAt.match(/\d{4}-\d{2}-\d{2}/);
      if (m) serviceDateEvidence.push(m[0]);
    }
  }

  const evidenceNumbers = [
    count,
    ...Object.values(severityCounts),
    ...(min !== undefined ? [min] : []),
    ...(max !== undefined ? [max] : []),
    ...(avg !== undefined ? [avg] : []),
    ...collectRowNumbers(rows),
    ...serviceNumberEvidence,
    ...(timeRangeHours != null ? [timeRangeHours] : []),
  ]
    .map(round2)
    .filter((v): v is number => Number.isFinite(v));

  const evidenceDates = [
    ...collectRowDates(rows),
    ...serviceDateEvidence,
    new Date().toISOString().slice(0, 10), // "today"
  ];

  return { summaryInput, evidenceNumbers, evidenceDates };
}

/** Numeric tokens in the LLM's sentence (handles percentages and decimals). */
function extractSummaryNumbers(text: string): number[] {
  return (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Full dates (YYYY-MM-DD) in the LLM's sentence. */
function extractSummaryDates(text: string): string[] {
  return text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
}

/** Half a decimal place: a benign 1-dp rounding (20.62 vs "20.6") is accepted,
 *  a genuine fabrication (20.54 vs "20.6") is rejected. */
const ROUNDING_TOLERANCE = 0.051;

function hasMatchingEvidence(value: number, evidence: number[]): boolean {
  return evidence.some((e) => Math.abs(e - value) <= ROUNDING_TOLERANCE);
}

export function validateSummary(
  summary: string,
  context: SummaryContext
): { ok: boolean; offending: string[] } {
  const offending: string[] = [];
  // Ignore the digit fragments of ISO dates (YYYY-MM-DD) for the number check;
  // the date itself is validated separately below.
  const dateStripped = summary.replace(/\d{4}-\d{2}-\d{2}/g, "");
  for (const n of extractSummaryNumbers(dateStripped)) {
    if (!hasMatchingEvidence(n, context.evidenceNumbers)) {
      offending.push(String(n));
    }
  }
  const evidenceDates = new Set(context.evidenceDates);
  for (const d of extractSummaryDates(summary)) {
    if (!evidenceDates.has(d)) {
      offending.push(d);
    }
  }
  return { ok: offending.length === 0, offending };
}

/** Deterministic, fully row-derived sentence used when validation fails. */
export function buildFallbackSummary(rows: unknown[]): string {
  if (rows.length === 0) {
    return "No matching records were found for your question.";
  }
  const parts = [
    `Found ${rows.length} matching record${rows.length === 1 ? "" : "s"}.`,
  ];
  const bySeverity: Record<string, number> = {};
  const clientNames = new Set<string>();
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const key = r.severity ?? r.level ?? r.latestStatus;
    if (typeof key === "string") bySeverity[key] = (bySeverity[key] ?? 0) + 1;
    if (typeof r.clientName === "string") clientNames.add(r.clientName);
  }
  const sev = Object.entries(bySeverity)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");
  if (sev) parts.push(`Breakdown: ${sev}.`);
  if (clientNames.size > 0) {
    const listed = [...clientNames].slice(0, 5).join(", ");
    parts.push(
      `Clients: ${listed}${clientNames.size > 5 ? " (and more)" : ""}.`
    );
  }
  return parts.join(" ");
}

interface SummarizeResult {
  summary: string;
  validationFailed: boolean;
}

async function summarize(
  question: string,
  rows: unknown[],
  context: SummaryContext
): Promise<SummarizeResult> {
  if (rows.length === 0) {
    return {
      summary: "No matching records were found for your question.",
      validationFailed: false,
    };
  }
  const user = `User question: "${question}"\n\nGrounded data (exact aggregates + sample of the retrieved rows):\n${context.summaryInput}`;
  const raw = await llmChat(summarizerSystem, user);
  const check = validateSummary(raw, context);
  if (!check.ok) {
    return { summary: buildFallbackSummary(rows), validationFailed: true };
  }
  return { summary: raw, validationFailed: false };
}

async function resolveClientId(name?: string) {
  if (!name) return undefined;
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(ilike(clients.name, `%${name}%`))
    .limit(1);
  return client?.id;
}

export async function answerNlpQuestion(question: string) {
  const filter = await parseQuestion(question);
  const since =
    filter.timeRangeHours != null
      ? new Date(Date.now() - filter.timeRangeHours * 60 * 60 * 1000)
      : null;
  const clientId = await resolveClientId(filter.clientName);

  let rows: unknown[] = [];

  const logLevelFromSeverity = (
    severity?: ParsedFilter["severity"]
  ): typeof logs.$inferSelect.level | undefined => {
    if (severity === "critical") return "error";
    if (severity === "warning") return "warning";
    if (severity === "info") return "info";
    return undefined;
  };

  if (filter.intent === "logs") {
    const conditions = [];
    const logLevel = logLevelFromSeverity(filter.severity);
    if (logLevel) conditions.push(eq(logs.level, logLevel));
    if (filter.assetType) conditions.push(eq(clientAssets.assetType, filter.assetType));
    if (clientId) conditions.push(eq(logs.clientId, clientId));
    if (since) conditions.push(gte(logs.createdAt, since));

    rows = await db
      .select({
        id: logs.id,
        level: logs.level,
        source: logs.source,
        message: logs.message,
        createdAt: logs.createdAt,
        clientName: clients.name,
      })
      .from(logs)
      .leftJoin(clients, eq(logs.clientId, clients.id))
      .leftJoin(clientAssets, eq(logs.assetId, clientAssets.id))
      .where(and(...conditions))
      .orderBy(filter.sort === "oldest" ? logs.createdAt : desc(logs.createdAt))
      .limit(50);
  } else if (filter.intent === "clients" || filter.intent === "assets") {
    const conditions = [];
    if (filter.assetType) conditions.push(eq(clientAssets.assetType, filter.assetType));
    if (clientId) conditions.push(eq(clientAssets.clientId, clientId));

    rows = await db
      .select({
        id: clientAssets.id,
        name: clientAssets.name,
        type: clientAssets.assetType,
        status: clientAssets.status,
        clientName: clients.name,
      })
      .from(clientAssets)
      .leftJoin(clients, eq(clientAssets.clientId, clients.id))
      .where(and(...conditions))
      .limit(50);
  } else if (filter.intent === "services") {
    // One row per service_checks row, carrying its most recent
    // service_check_results (real prober data). clientName / assetType filter
    // the same way as elsewhere; timeRangeHours, when given, keeps only checks
    // whose latest result is within that window ("recently checked").
    const conditions = [];
    if (filter.assetType)
      conditions.push(eq(clientAssets.assetType, filter.assetType));
    if (clientId) conditions.push(eq(clientAssets.clientId, clientId));

    const checkRows = await db
      .select({
        id: serviceChecks.id,
        name: serviceChecks.name,
        checkType: serviceChecks.checkType,
        target: serviceChecks.target,
        intervalSeconds: serviceChecks.intervalSeconds,
        isActive: serviceChecks.isActive,
        assetName: clientAssets.name,
        assetType: clientAssets.assetType,
        clientName: clients.name,
      })
      .from(serviceChecks)
      .leftJoin(clientAssets, eq(serviceChecks.assetId, clientAssets.id))
      .leftJoin(clients, eq(clientAssets.clientId, clients.id))
      .where(and(...conditions))
      .limit(50);

    let serviceRows = await Promise.all(
      checkRows.map(async (check) => {
        const [latest] = await db
          .select({
            status: serviceCheckResults.status,
            latencyMs: serviceCheckResults.latencyMs,
            statusCode: serviceCheckResults.statusCode,
            errorMessage: serviceCheckResults.errorMessage,
            checkedAt: serviceCheckResults.checkedAt,
          })
          .from(serviceCheckResults)
          .where(eq(serviceCheckResults.checkId, check.id))
          .orderBy(desc(serviceCheckResults.checkedAt))
          .limit(1);
        return {
          ...check,
          latestStatus: latest?.status ?? null,
          latencyMs: latest?.latencyMs ?? null,
          statusCode: latest?.statusCode ?? null,
          errorMessage: latest?.errorMessage ?? null,
          checkedAt: latest?.checkedAt ?? null,
        };
      })
    );

    if (since) {
      serviceRows = serviceRows.filter(
        (r) => r.checkedAt != null && new Date(r.checkedAt) >= since
      );
    }
    if (filter.sort === "oldest") {
      serviceRows.sort(
        (a, b) =>
          (a.checkedAt ? new Date(a.checkedAt).getTime() : 0) -
          (b.checkedAt ? new Date(b.checkedAt).getTime() : 0)
      );
    } else {
      serviceRows.sort(
        (a, b) =>
          (b.checkedAt ? new Date(b.checkedAt).getTime() : 0) -
          (a.checkedAt ? new Date(a.checkedAt).getTime() : 0)
      );
    }

    rows = serviceRows;
  } else {
    // default alerts
    const conditions = [];
    if (filter.severity) conditions.push(eq(alerts.severity, filter.severity));
    if (filter.assetType) conditions.push(eq(clientAssets.assetType, filter.assetType));
    if (clientId) conditions.push(eq(alerts.clientId, clientId));
    if (since) conditions.push(gte(alerts.triggeredAt, since));

    rows = await db
      .select({
        id: alerts.id,
        severity: alerts.severity,
        message: alerts.message,
        computedValue: alerts.computedValue,
        triggeredAt: alerts.triggeredAt,
        clientName: clients.name,
      })
      .from(alerts)
      .leftJoin(clients, eq(alerts.clientId, clients.id))
      .leftJoin(clientAssets, eq(alerts.assetId, clientAssets.id))
      .where(and(...conditions))
      .orderBy(filter.sort === "oldest" ? alerts.triggeredAt : desc(alerts.triggeredAt))
      .limit(50);
  }

  const context = buildSummaryContext(rows, filter.intent, filter.timeRangeHours);
  const { summary, validationFailed } = await summarize(
    question,
    rows,
    context
  );

  await db.insert(nlpQueries).values({
    question,
    filter: filter as unknown as typeof nlpQueries.$inferInsert.filter,
    resultCount: rows.length,
    summary,
    validationFailed,
  });

  return { filter, summary, rows, validationFailed };
}