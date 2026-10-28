import "./env";
import { db } from "../app/lib/db";
import { logInstagramEvent, logEvent } from "../app/lib/logger";
import { clients, clientAssets, logs } from "../app/lib/schema";
import { eq } from "drizzle-orm";

const TEST_ACCOUNT = "verify_atlas_logs";

async function main() {
  // Ensure a test client + chatbot asset exists.
  let [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.name, "__verify_logs_client__"));

  if (!client) {
    [client] = await db
      .insert(clients)
      .values({
        name: "__verify_logs_client__",
        tier: "starter",
        status: "active",
      })
      .returning();
  }

  let [asset] = await db
    .select()
    .from(clientAssets)
    .where(eq(clientAssets.name, "__verify_chatbot__"));

  if (!asset) {
    [asset] = await db
      .insert(clientAssets)
      .values({
        clientId: client.id,
        assetType: "chatbot",
        name: "__verify_chatbot__",
        meta: { platform: "instagram", linkedAccount: TEST_ACCOUNT },
        sourceType: "manual",
        status: "active",
      })
      .returning();
  }

  // Log a recognised-account event.
  const recognised = await logInstagramEvent(
    TEST_ACCOUNT,
    "info",
    "Verification log from test script",
    { test: true }
  );

  // Log an unrecognised-account event.
  const unrecognised = await logInstagramEvent(
    "unknown_account_12345",
    "warning",
    "Verification log for unrecognised account"
  );

  // Also log a generic event.
  const generic = await logEvent({
    clientId: client.id,
    level: "error",
    source: "test-service",
    message: "Generic test log event",
  });

  console.log("Recognised account log:", recognised);
  console.log("Unrecognised account log:", unrecognised);
  console.log("Generic log:", generic);

  // Read back the most recent logs for the client.
  const recent = await db
    .select()
    .from(logs)
    .where(eq(logs.clientId, client.id))
    .orderBy(logs.createdAt);

  console.log(`Found ${recent.length} logs for test client.`);

  // Cleanup.
  await db.delete(logs).where(eq(logs.clientId, client.id));
  await db.delete(clientAssets).where(eq(clientAssets.id, asset.id));
  await db.delete(clients).where(eq(clients.id, client.id));

  console.log("Verification complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
