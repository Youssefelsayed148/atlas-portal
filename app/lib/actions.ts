"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "./auth";
import { db } from "./db";
import {
  clients,
  clientAssets,
  activityLog,
  assetTypeEnum,
  clientTierEnum,
  clientStatusEnum,
  assetStatusEnum,
} from "./schema";
import {
  roleCanManageClients,
  roleCanManageAssetType,
  type UserRole,
} from "./roles";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

async function getCurrentUser() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return session.user as {
    id: string;
    email: string;
    name: string;
    role: UserRole;
  };
}

async function logActivity(
  userId: string,
  action: string,
  detail?: string,
  clientId?: string
) {
  await db.insert(activityLog).values({
    userId,
    action,
    detail: detail ?? null,
    clientId: clientId ?? null,
  });
}

const clientSchema = z.object({
  name: z.string().min(1),
  tier: z.enum(clientTierEnum.enumValues),
  status: z.enum(clientStatusEnum.enumValues),
  color: z.string().optional(),
  initials: z.string().optional(),
});

const assetTypeSchema = z.enum(assetTypeEnum.enumValues);

function cleanMetaValue(value: unknown) {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }
  return value;
}

const optionalString = z.preprocess(cleanMetaValue, z.string().optional());
const optionalUrl = z.preprocess(
  cleanMetaValue,
  z.string().url().optional()
);
const optionalDate = z.preprocess(cleanMetaValue, z.coerce.date().optional());
const optionalNumber = z.preprocess(
  cleanMetaValue,
  z.coerce.number().int().min(0).optional()
);
const optionalBoolean = z.preprocess(
  cleanMetaValue,
  z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .optional()
);

const assetMetaSchema = z.discriminatedUnion("assetType", [
  z.object({
    assetType: z.literal("website"),
    url: optionalUrl,
    hostingProvider: optionalString,
    cms: optionalString,
  }),
  z.object({
    assetType: z.literal("app"),
    platform: z.string().min(1),
    version: optionalString,
    repoUrl: optionalUrl,
  }),
  z.object({
    assetType: z.literal("chatbot"),
    platform: z.string().min(1),
    triggerKeywords: optionalString,
    linkedAccount: optionalString,
  }),
  z.object({
    assetType: z.literal("document"),
    fileName: z.string().min(1),
    docType: z.enum(["contract", "brand_guide", "other"]),
    expiryDate: optionalDate,
  }),
  z.object({
    assetType: z.literal("social"),
    platform: z.string().min(1),
    handle: optionalString,
    followerCount: optionalNumber,
    connected: optionalBoolean,
  }),
]);

const baseAssetSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1),
});

export async function createClient(
  _: unknown,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!roleCanManageClients(user.role)) {
    throw new Error("You do not have permission to manage clients.");
  }

  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    tier: formData.get("tier"),
    status: formData.get("status"),
    color: formData.get("color") || undefined,
    initials: formData.get("initials") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const [client] = await db
    .insert(clients)
    .values({
      name: parsed.data.name,
      tier: parsed.data.tier,
      status: parsed.data.status,
      color: parsed.data.color ?? null,
      initials: parsed.data.initials ?? null,
    })
    .returning();

  await logActivity(
    user.id,
    "create_client",
    `Created client ${client.name}`,
    client.id
  );

  revalidatePath("/clients");
  return { success: true };
}

export async function updateClient(
  clientId: string,
  _: unknown,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!roleCanManageClients(user.role)) {
    throw new Error("You do not have permission to manage clients.");
  }

  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    tier: formData.get("tier"),
    status: formData.get("status"),
    color: formData.get("color") || undefined,
    initials: formData.get("initials") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  await db
    .update(clients)
    .set({
      name: parsed.data.name,
      tier: parsed.data.tier,
      status: parsed.data.status,
      color: parsed.data.color ?? null,
      initials: parsed.data.initials ?? null,
    })
    .where(eq(clients.id, clientId));

  await logActivity(
    user.id,
    "update_client",
    `Updated client ${clientId}`,
    clientId
  );

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  return { success: true };
}

export async function archiveClient(
  clientId: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!roleCanManageClients(user.role)) {
    throw new Error("You do not have permission to manage clients.");
  }

  await db
    .update(clients)
    .set({ status: "offboarded" })
    .where(eq(clients.id, clientId));

  await logActivity(
    user.id,
    "archive_client",
    `Archived client ${clientId}`,
    clientId
  );

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  return { success: true };
}

export async function createClientAsset(
  _: unknown,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  const assetType = formData.get("assetType") as any;

  if (!roleCanManageAssetType(user.role, assetType)) {
    throw new Error(`You do not have permission to manage ${assetType} assets.`);
  }

  const baseParsed = baseAssetSchema.safeParse({
    clientId: formData.get("clientId"),
    name: formData.get("name"),
  });
  if (!baseParsed.success) {
    return { success: false, error: baseParsed.error.message };
  }

  const rawMeta = Object.fromEntries(
    Array.from(formData.entries()).filter(
      ([key]) =>
        !["clientId", "name", "assetType"].includes(key) &&
        !key.startsWith("$")
    )
  );

  const metaParsed = assetMetaSchema.safeParse({
    assetType,
    ...rawMeta,
  });
  if (!metaParsed.success) {
    return { success: false, error: metaParsed.error.message };
  }

  const meta = metaParsed.data;
  const { assetType: _type, ...metaPayload } = meta as any;

  const [asset] = await db
    .insert(clientAssets)
    .values({
      clientId: baseParsed.data.clientId,
      assetType: assetType,
      name: baseParsed.data.name,
      meta: metaPayload,
      sourceType: "manual",
      externalRef: null,
      status: "active",
      createdBy: user.id,
    })
    .returning();

  await logActivity(
    user.id,
    "create_asset",
    `Created ${assetType} asset ${asset.name}`,
    asset.clientId
  );

  revalidatePath(`/clients/${asset.clientId}`);
  return { success: true };
}

export async function updateClientAsset(
  assetId: string,
  _: unknown,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  const assetType = formData.get("assetType") as any;

  if (!roleCanManageAssetType(user.role, assetType)) {
    throw new Error(`You do not have permission to manage ${assetType} assets.`);
  }

  const baseParsed = baseAssetSchema.safeParse({
    clientId: formData.get("clientId"),
    name: formData.get("name"),
  });
  if (!baseParsed.success) {
    return { success: false, error: baseParsed.error.message };
  }

  const rawMeta = Object.fromEntries(
    Array.from(formData.entries()).filter(
      ([key]) =>
        !["clientId", "name", "assetType"].includes(key) &&
        !key.startsWith("$")
    )
  );

  const metaParsed = assetMetaSchema.safeParse({
    assetType,
    ...rawMeta,
  });
  if (!metaParsed.success) {
    return { success: false, error: metaParsed.error.message };
  }

  const meta = metaParsed.data;
  const { assetType: _type, ...metaPayload } = meta as any;

  const [asset] = await db
    .update(clientAssets)
    .set({
      name: baseParsed.data.name,
      meta: metaPayload,
      status: (formData.get("status") as any) ?? "active",
    })
    .where(
      and(
        eq(clientAssets.id, assetId),
        eq(clientAssets.assetType, assetType),
        eq(clientAssets.sourceType, "manual")
      )
    )
    .returning();

  if (!asset) {
    return { success: false, error: "Asset not found." };
  }

  await logActivity(
    user.id,
    "update_asset",
    `Updated ${assetType} asset ${asset.name}`,
    asset.clientId
  );

  revalidatePath(`/clients/${asset.clientId}`);
  return { success: true };
}

export async function archiveClientAsset(
  assetId: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();

  const [asset] = await db
    .select()
    .from(clientAssets)
    .where(eq(clientAssets.id, assetId));
  if (!asset) {
    return { success: false, error: "Asset not found." };
  }

  if (!roleCanManageAssetType(user.role, asset.assetType)) {
    throw new Error(
      `You do not have permission to manage ${asset.assetType} assets.`
    );
  }

  await db
    .update(clientAssets)
    .set({ status: "archived" })
    .where(eq(clientAssets.id, assetId));

  await logActivity(
    user.id,
    "archive_asset",
    `Archived ${asset.assetType} asset ${asset.name}`,
    asset.clientId
  );

  revalidatePath(`/clients/${asset.clientId}`);
  return { success: true };
}
