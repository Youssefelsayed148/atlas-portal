CREATE TABLE "nlp_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"filter" jsonb DEFAULT '{}' NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
