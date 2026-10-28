import { db } from "./db";
import { logs, clientAssets } from "./schema";
import { eq, and, sql } from "drizzle-orm";

export type LogLevel = "info" | "warning" | "error";

export interface LogEventInput {
  clientId?: string | null;
  assetId?: string | null;
  level: LogLevel;
  source: string;
  message: string;
  raw?: Record<string, unknown> | null;
}

/**
 * Resolve the chatbot asset (and its client) for a given Instagram account.
 * Returns null when the account is not recognised.
 */
export async function resolveInstagramAccount(account: string) {
  const normalised = account.toLowerCase().replace(/^@/, "");
  const [asset] = await db
    .select({
      id: clientAssets.id,
      clientId: clientAssets.clientId,
    })
    .from(clientAssets)
    .where(
      and(
        eq(clientAssets.assetType, "chatbot"),
        sql`lower((${clientAssets.meta}->>'linkedAccount')::text) = ${normalised}`
      )
    )
    .limit(1);

  return asset ?? null;
}

/**
 * Shared logging utility for all Atlas-integrated services.
 * Always writes the row; if clientId/assetId cannot be resolved, log it with
 * client_id = null and a clear message so events are never dropped silently.
 */
export async function logEvent(input: LogEventInput) {
  const row = await db
    .insert(logs)
    .values({
      clientId: input.clientId ?? null,
      assetId: input.assetId ?? null,
      level: input.level,
      source: input.source,
      message: input.message,
      raw: input.raw ?? null,
    })
    .returning();

  return row[0];
}

/**
 * Convenience helper for the Instagram comment-to-DM automation service.
 * Resolves the Instagram account to a client/chatbot asset before logging.
 */
export async function logInstagramEvent(
  account: string,
  level: LogLevel,
  message: string,
  raw?: Record<string, unknown>
) {
  const resolved = await resolveInstagramAccount(account);

  if (!resolved) {
    return logEvent({
      level: "warning",
      source: "instagram-automation",
      message: `Unrecognised Instagram account "${account}" — ${message}`,
      raw: { originalLevel: level, originalMessage: message, ...raw },
    });
  }

  return logEvent({
    clientId: resolved.clientId,
    assetId: resolved.id,
    level,
    source: "instagram-automation",
    message,
    raw: raw ?? null,
  });
}
