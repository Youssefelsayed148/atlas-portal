"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { activityLog, checkTypeEnum, clientAssets, serviceChecks } from "./schema";
import {
  roleCanManageAssetType,
  roleCanManageClients,
  roleCanViewSection,
  type UserRole,
} from "./roles";
import { getCurrentUser } from "./session";

type ActionResult = { success: boolean; error?: string };

/** Asset types a service check can be attached to. */
const CHECKABLE_ASSET_TYPES = ["website", "app", "chatbot"] as const;

type CheckType = (typeof checkTypeEnum.enumValues)[number];

function blank(value: unknown) {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const optionalText = z.preprocess(blank, z.string().trim().max(2000).optional());
const optionalInt = (min: number, max: number) =>
  z.preprocess(blank, z.coerce.number().int().min(min).max(max).optional());

const formSchema = z.object({
  assetId: z.string().uuid(),
  checkType: z.enum(checkTypeEnum.enumValues),
  name: z.string().trim().min(1, "Name is required").max(120),
  target: z.string().trim().min(1, "Target is required").max(2048),
  intervalSeconds: z.coerce
    .number()
    .int()
    .min(60, "Interval must be at least 60 seconds (the prober ticks every 60s)")
    .max(86400),
  method: z.preprocess(blank, z.enum(["GET", "HEAD", "POST"]).optional()),
  timeoutMs: optionalInt(1000, 60000),
  latencyWarningMs: optionalInt(1, 600000),
  expectedStatusMin: optionalInt(100, 599),
  expectedStatusMax: optionalInt(100, 599),
  bodyContains: optionalText,
  headers: optionalText,
  expectedField: optionalText,
  expectedValue: optionalText,
  healthQuery: optionalText,
  staleAfterMinutes: optionalInt(1, 10080),
});

type ParsedForm = z.infer<typeof formSchema>;

/** "Authorization: Bearer x" per line -> { Authorization: "Bearer x" } */
function parseHeaders(
  text: string | undefined
): { headers?: Record<string, string>; error?: string } {
  if (!text) return {};
  const headers: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) {
      return { error: `Header line "${line.slice(0, 40)}" must look like Name: value` };
    }
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!/^[A-Za-z0-9-]+$/.test(name)) {
      return { error: `Invalid header name "${name}"` };
    }
    headers[name] = value;
  }
  return Object.keys(headers).length > 0 ? { headers } : {};
}

/** Expected JSON value: "true", "42", '"ok"' parse as JSON; anything else is a plain string. */
function parseExpectedValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function validateTarget(checkType: CheckType, target: string): string | null {
  if (checkType === "http" || checkType === "api") {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return "Target must be a full URL, for example https://example.com/health";
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Only http:// and https:// targets are allowed";
    }
    return null;
  }
  if (checkType === "db") {
    return /^postgres(ql)?:\/\//i.test(target)
      ? null
      : "Database target must be a postgres:// or postgresql:// connection string";
  }
  return null; // webhook: free-text label, the prober makes no outbound call
}

/** Guard against casual mistakes, not a sandbox: use a read-only DB user for real safety. */
function validateHealthQuery(query: string): string | null {
  const trimmed = query.trim().replace(/;+\s*$/, "");
  if (!/^select\b/i.test(trimmed)) return "Health query must start with SELECT";
  if (trimmed.includes(";")) return "Health query must be a single statement";
  return null;
}

function buildConfig(
  data: ParsedForm
): { config?: Record<string, unknown>; error?: string } {
  const config: Record<string, unknown> = {};

  if (data.checkType === "http" || data.checkType === "api") {
    if (data.method) config.method = data.method;
    if (data.timeoutMs != null) config.timeoutMs = data.timeoutMs;
    if (data.latencyWarningMs != null) config.latencyWarningMs = data.latencyWarningMs;
    if (data.bodyContains) config.bodyContains = data.bodyContains;

    const { expectedStatusMin: min, expectedStatusMax: max } = data;
    if ((min != null) !== (max != null)) {
      return { error: "Set both the minimum and maximum expected status, or neither" };
    }
    if (min != null && max != null) {
      if (min > max) return { error: "Minimum expected status is above the maximum" };
      config.expectedStatus = [min, max];
    }
  }

  if (data.checkType === "api") {
    const parsed = parseHeaders(data.headers);
    if (parsed.error) return { error: parsed.error };
    if (parsed.headers) config.headers = parsed.headers;

    if (data.expectedField) {
      if (data.expectedValue == null) {
        return { error: "Give an expected value for the expected JSON field" };
      }
      config.expectedField = data.expectedField;
      config.expectedValue = parseExpectedValue(data.expectedValue);
    }
  }

  if (data.checkType === "db") {
    if (data.timeoutMs != null) config.timeoutMs = data.timeoutMs;
    if (data.latencyWarningMs != null) config.latencyWarningMs = data.latencyWarningMs;
    if (data.healthQuery) {
      const err = validateHealthQuery(data.healthQuery);
      if (err) return { error: err };
      config.healthQuery = data.healthQuery.trim();
    }
  }

  if (data.checkType === "webhook" && data.staleAfterMinutes != null) {
    config.staleAfterMinutes = data.staleAfterMinutes;
  }

  return { config };
}

function readForm(formData: FormData, assetId: string) {
  const raw: Record<string, FormDataEntryValue | null> = {};
  for (const key of Object.keys(formSchema.shape)) {
    raw[key] = formData.get(key);
  }
  raw.assetId = assetId;
  return formSchema.safeParse(raw);
}

function requireCheckManager(role: UserRole) {
  if (!roleCanViewSection(role, "health") || !roleCanManageClients(role)) {
    throw new Error("You do not have permission to manage service checks.");
  }
}

async function loadAsset(assetId: string) {
  const [asset] = await db
    .select()
    .from(clientAssets)
    .where(eq(clientAssets.id, assetId));
  return asset ?? null;
}

async function loadCheckWithAsset(checkId: string) {
  const [row] = await db
    .select({ check: serviceChecks, asset: clientAssets })
    .from(serviceChecks)
    .innerJoin(clientAssets, eq(serviceChecks.assetId, clientAssets.id))
    .where(eq(serviceChecks.id, checkId));
  return row ?? null;
}

function assertAssetAllowed(role: UserRole, asset: typeof clientAssets.$inferSelect) {
  if (!(CHECKABLE_ASSET_TYPES as readonly string[]).includes(asset.assetType)) {
    throw new Error("Service checks can only be attached to website, app or chatbot assets.");
  }
  if (!roleCanManageAssetType(role, asset.assetType)) {
    throw new Error(`You do not have permission to manage ${asset.assetType} assets.`);
  }
}

/** Activity detail never includes the target or headers: they can hold credentials. */
async function logActivity(userId: string, clientId: string, action: string, detail: string) {
  await db.insert(activityLog).values({ userId, clientId, action, detail });
}

export async function createServiceCheck(
  _: unknown,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  requireCheckManager(user.role);

  const assetId = String(formData.get("assetId") ?? "");
  const parsed = readForm(formData, assetId);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const asset = await loadAsset(data.assetId);
  if (!asset) return { success: false, error: "Asset not found." };
  assertAssetAllowed(user.role, asset);

  const targetError = validateTarget(data.checkType, data.target);
  if (targetError) return { success: false, error: targetError };

  const built = buildConfig(data);
  if (built.error) return { success: false, error: built.error };

  const [duplicate] = await db
    .select({ id: serviceChecks.id })
    .from(serviceChecks)
    .where(and(eq(serviceChecks.assetId, asset.id), eq(serviceChecks.name, data.name)))
    .limit(1);
  if (duplicate) {
    return { success: false, error: "This asset already has a check with that name." };
  }

  await db.insert(serviceChecks).values({
    assetId: asset.id,
    checkType: data.checkType,
    name: data.name,
    target: data.target,
    config: built.config ?? {},
    intervalSeconds: data.intervalSeconds,
    isActive: true,
  });

  await logActivity(
    user.id,
    asset.clientId,
    "create_service_check",
    `Created ${data.checkType} check "${data.name}" on ${asset.name}`
  );
  revalidatePath(`/clients/${asset.clientId}`);
  return { success: true };
}

export async function updateServiceCheck(
  checkId: string,
  _: unknown,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  requireCheckManager(user.role);

  const existing = await loadCheckWithAsset(checkId);
  if (!existing) return { success: false, error: "Check not found." };
  assertAssetAllowed(user.role, existing.asset);

  // The asset is fixed after creation; the type can change.
  const parsed = readForm(formData, existing.asset.id);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const targetError = validateTarget(data.checkType, data.target);
  if (targetError) return { success: false, error: targetError };

  const built = buildConfig(data);
  if (built.error) return { success: false, error: built.error };

  const [duplicate] = await db
    .select({ id: serviceChecks.id })
    .from(serviceChecks)
    .where(
      and(
        eq(serviceChecks.assetId, existing.asset.id),
        eq(serviceChecks.name, data.name),
        ne(serviceChecks.id, checkId)
      )
    )
    .limit(1);
  if (duplicate) {
    return { success: false, error: "This asset already has a check with that name." };
  }

  await db
    .update(serviceChecks)
    .set({
      checkType: data.checkType,
      name: data.name,
      target: data.target,
      config: built.config ?? {},
      intervalSeconds: data.intervalSeconds,
    })
    .where(eq(serviceChecks.id, checkId));

  await logActivity(
    user.id,
    existing.asset.clientId,
    "update_service_check",
    `Updated ${data.checkType} check "${data.name}" on ${existing.asset.name}`
  );
  revalidatePath(`/clients/${existing.asset.clientId}`);
  return { success: true };
}

export async function toggleServiceCheck(checkId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  requireCheckManager(user.role);

  const existing = await loadCheckWithAsset(checkId);
  if (!existing) return { success: false, error: "Check not found." };
  assertAssetAllowed(user.role, existing.asset);

  const nextActive = !existing.check.isActive;
  await db
    .update(serviceChecks)
    .set({ isActive: nextActive })
    .where(eq(serviceChecks.id, checkId));

  await logActivity(
    user.id,
    existing.asset.clientId,
    nextActive ? "resume_service_check" : "pause_service_check",
    `${nextActive ? "Resumed" : "Paused"} check "${existing.check.name}" on ${existing.asset.name}`
  );
  revalidatePath(`/clients/${existing.asset.clientId}`);
  return { success: true };
}

/** Deletes the check and, via ON DELETE CASCADE, its results and linked alerts. */
export async function deleteServiceCheck(checkId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  requireCheckManager(user.role);

  const existing = await loadCheckWithAsset(checkId);
  if (!existing) return { success: false, error: "Check not found." };
  assertAssetAllowed(user.role, existing.asset);

  await db.delete(serviceChecks).where(eq(serviceChecks.id, checkId));

  await logActivity(
    user.id,
    existing.asset.clientId,
    "delete_service_check",
    `Deleted check "${existing.check.name}" on ${existing.asset.name}`
  );
  revalidatePath(`/clients/${existing.asset.clientId}`);
  return { success: true };
}
