import "./env";
import fs from "fs";
import path from "path";
import Papa from "papaparse";
import { db } from "../app/lib/db";
import { clients, clientAssets } from "../app/lib/schema";
import { eq } from "drizzle-orm";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: pnpm tsx scripts/import-clients.ts <path-to.csv>");
  process.exit(1);
}

const allowedTiers = ["starter", "growth", "enterprise"] as const;
const allowedStatuses = [
  "onboarding",
  "active",
  "at_risk",
  "paused",
  "offboarded",
] as const;
const allowedAssetTypes = [
  "website",
  "app",
  "chatbot",
  "document",
  "social",
] as const;

type ImportRow = {
  client_name?: string;
  client_tier?: string;
  client_status?: string;
  client_color?: string;
  client_initials?: string;
  asset_type?: string;
  asset_name?: string;
  asset_meta?: string;
  asset_source_type?: string;
  external_ref?: string;
};

async function getOrCreateClient(row: ImportRow) {
  const name = row.client_name?.trim();
  if (!name) throw new Error("client_name is required");

  const existing = await db
    .select()
    .from(clients)
    .where(eq(clients.name, name))
    .limit(1);
  if (existing[0]) return existing[0];

  const tier = row.client_tier?.trim() ?? "starter";
  const status = row.client_status?.trim() ?? "active";
  if (!allowedTiers.includes(tier as any)) throw new Error(`Invalid tier: ${tier}`);
  if (!allowedStatuses.includes(status as any))
    throw new Error(`Invalid status: ${status}`);

  const [client] = await db
    .insert(clients)
    .values({
      name,
      tier: tier as any,
      status: status as any,
      color: row.client_color?.trim() || null,
      initials: row.client_initials?.trim() || null,
    })
    .returning();
  return client;
}

async function importRow(row: ImportRow, line: number) {
  const client = await getOrCreateClient(row);

  const assetType = row.asset_type?.trim();
  const assetName = row.asset_name?.trim();

  if (!assetType && !assetName) {
    // Row is just a client definition; that's ok.
    return { clientId: client.id };
  }

  if (!assetType || !allowedAssetTypes.includes(assetType as any)) {
    throw new Error(`Invalid or missing asset_type: ${assetType}`);
  }
  if (!assetName) throw new Error("asset_name is required when asset_type is provided");

  let meta: Record<string, unknown> = {};
  if (row.asset_meta?.trim()) {
    try {
      meta = JSON.parse(row.asset_meta);
    } catch {
      throw new Error(`asset_meta is not valid JSON: ${row.asset_meta}`);
    }
  }

  const sourceType = row.asset_source_type?.trim() ?? "manual";
  if (sourceType !== "manual" && sourceType !== "synced") {
    throw new Error(`Invalid asset_source_type: ${sourceType}`);
  }

  const [asset] = await db
    .insert(clientAssets)
    .values({
      clientId: client.id,
      assetType: assetType as any,
      name: assetName,
      meta,
      sourceType: sourceType as any,
      externalRef: row.external_ref?.trim() || null,
      status: "active",
    })
    .returning();

  return { clientId: client.id, client, asset };
}

async function main() {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  const csv = fs.readFileSync(fullPath, "utf-8");
  const parsed = Papa.parse<ImportRow>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  const failures: { line: number; reason: string; row: ImportRow }[] = [];
  const clientsCreated = new Set<string>();
  let assetsCreated = 0;

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    const line = i + 2; // 1-based header offset
    try {
      const result = await importRow(row, line);
      clientsCreated.add(result.clientId);
      if ("asset" in result) assetsCreated++;
    } catch (err) {
      failures.push({
        line,
        reason: err instanceof Error ? err.message : String(err),
        row,
      });
    }
  }

  console.log(`Imported ${clientsCreated.size} clients and ${assetsCreated} assets.`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} row(s) failed:`);
    for (const f of failures) {
      console.error(`Line ${f.line}: ${f.reason}`);
      console.error(JSON.stringify(f.row));
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
