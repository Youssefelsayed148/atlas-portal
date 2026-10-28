CREATE TYPE "public"."check_status" AS ENUM('up', 'down', 'degraded');--> statement-breakpoint
CREATE TYPE "public"."check_type" AS ENUM('http', 'api', 'db', 'webhook');--> statement-breakpoint
CREATE TABLE "service_check_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "check_status" NOT NULL,
	"latency_ms" integer,
	"status_code" integer,
	"error_message" text,
	"raw_response" jsonb
);
--> statement-breakpoint
CREATE TABLE "service_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"check_type" "check_type" NOT NULL,
	"name" text NOT NULL,
	"target" text NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"interval_seconds" integer DEFAULT 300 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "check_id" uuid;--> statement-breakpoint
ALTER TABLE "service_check_results" ADD CONSTRAINT "service_check_results_check_id_service_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."service_checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_checks" ADD CONSTRAINT "service_checks_asset_id_client_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."client_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_check_results_check_checked_idx" ON "service_check_results" USING btree ("check_id","checked_at");--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_check_id_service_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."service_checks"("id") ON DELETE cascade ON UPDATE no action;