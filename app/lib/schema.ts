import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  jsonb,
  integer,
  real,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

// ------------------------------------------------------------------
// Enums
// ------------------------------------------------------------------

export const clientTierEnum = pgEnum("client_tier", [
  "starter",
  "growth",
  "enterprise",
]);

export const clientStatusEnum = pgEnum("client_status", [
  "onboarding",
  "active",
  "at_risk",
  "paused",
  "offboarded",
]);

export const assetTypeEnum = pgEnum("asset_type", [
  "website",
  "app",
  "chatbot",
  "document",
  "social",
]);

export const assetStatusEnum = pgEnum("asset_status", [
  "active",
  "inactive",
  "archived",
]);

export const sourceTypeEnum = pgEnum("source_type", ["manual", "synced"]);

export const logLevelEnum = pgEnum("log_level", ["info", "warning", "error"]);

export const alertSeverityEnum = pgEnum("alert_severity", [
  "info",
  "warning",
  "critical",
]);

export const checkTypeEnum = pgEnum("check_type", [
  "http",
  "api",
  "db",
  "webhook",
]);

export const checkStatusEnum = pgEnum("check_status", [
  "up",
  "down",
  "degraded",
]);

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "developer",
  "legal",
  "social_media_manager",
  "content_creator",
]);

// ------------------------------------------------------------------
// Better-Auth core tables (manual definition so `drizzle-kit push` works)
// ------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text("image"),
  role: userRoleEnum("role").notNull().default("content_creator"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt", { mode: "date" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { mode: "date" }),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { mode: "date" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt", { mode: "date" }).notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }),
  updatedAt: timestamp("updatedAt", { mode: "date" }),
});

// ------------------------------------------------------------------
// Atlas Portal tables
// ------------------------------------------------------------------

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tier: clientTierEnum("tier").notNull().default("starter"),
  status: clientStatusEnum("status").notNull().default("onboarding"),
  color: text("color"),
  initials: text("initials"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const clientAssets = pgTable("client_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  assetType: assetTypeEnum("asset_type").notNull(),
  name: text("name").notNull(),
  meta: jsonb("meta").notNull().default("{}"),
  sourceType: sourceTypeEnum("source_type").notNull().default("manual"),
  externalRef: text("external_ref"),
  status: assetStatusEnum("status").notNull().default("active"),
  createdBy: text("created_by").references(() => user.id),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const logs = pgTable(
  "logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    assetId: uuid("asset_id").references(() => clientAssets.id, {
      onDelete: "set null",
    }),
    level: logLevelEnum("level").notNull(),
    source: text("source").notNull(),
    message: text("message").notNull(),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clientCreatedIdx: index("logs_client_created_idx").on(
      table.clientId,
      table.createdAt
    ),
    levelCreatedIdx: index("logs_level_created_idx").on(
      table.level,
      table.createdAt
    ),
  })
);

export const alertRules = pgTable("alert_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  assetType: assetTypeEnum("asset_type"),
  metric: text("metric").notNull(),
  windowMinutes: integer("window_minutes"),
  warningThreshold: real("warning_threshold"),
  criticalThreshold: real("critical_threshold"),
  enabled: boolean("enabled").notNull().default(true),
});

export const serviceChecks = pgTable("service_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => clientAssets.id, { onDelete: "cascade" }),
  checkType: checkTypeEnum("check_type").notNull(),
  name: text("name").notNull(),
  target: text("target").notNull(),
  config: jsonb("config").notNull().default("{}"),
  intervalSeconds: integer("interval_seconds").notNull().default(300),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const serviceCheckResults = pgTable(
  "service_check_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkId: uuid("check_id")
      .notNull()
      .references(() => serviceChecks.id, { onDelete: "cascade" }),
    checkedAt: timestamp("checked_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    status: checkStatusEnum("status").notNull(),
    latencyMs: integer("latency_ms"),
    statusCode: integer("status_code"),
    errorMessage: text("error_message"),
    rawResponse: jsonb("raw_response"),
  },
  (table) => ({
    checkCheckedIdx: index("service_check_results_check_checked_idx").on(
      table.checkId,
      table.checkedAt
    ),
  })
);

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").references(() => clientAssets.id, {
    onDelete: "cascade",
  }),
  ruleId: uuid("rule_id")
    .notNull()
    .references(() => alertRules.id, { onDelete: "cascade" }),
  checkId: uuid("check_id").references(() => serviceChecks.id, {
    onDelete: "cascade",
  }),
  severity: alertSeverityEnum("severity").notNull(),
  computedValue: real("computed_value"),
  windowMinutes: integer("window_minutes"),
  message: text("message").notNull(),
  triggeredAt: timestamp("triggered_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  resolvedAt: timestamp("resolved_at", { mode: "date", withTimezone: true }),
});

export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").references(() => clients.id, {
    onDelete: "cascade",
  }),
  userId: text("user_id").references(() => user.id),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const nlpQueries = pgTable("nlp_queries", {
  id: uuid("id").primaryKey().defaultRandom(),
  question: text("question").notNull(),
  filter: jsonb("filter").notNull().default("{}"),
  resultCount: integer("result_count").notNull().default(0),
  summary: text("summary"),
  validationFailed: boolean("validation_failed").notNull().default(false),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
});
