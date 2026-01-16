CREATE TYPE "public"."defer_loading_behavior" AS ENUM('ENABLED', 'DISABLED', 'INHERIT');--> statement-breakpoint
CREATE TYPE "public"."tool_search_method" AS ENUM('NONE', 'REGEX', 'BM25', 'EMBEDDINGS');--> statement-breakpoint
CREATE TABLE "tool_search_config" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_uuid" uuid NOT NULL,
	"search_method" "tool_search_method" DEFAULT 'REGEX' NOT NULL,
	"regex_pattern" text,
	"bm25_config" jsonb,
	"embeddings_config" jsonb,
	"max_results" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_search_config_namespace_unique" UNIQUE("namespace_uuid")
);
--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "override_defer_loading" "defer_loading_behavior" DEFAULT 'INHERIT';--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "override_search_method" "tool_search_method";--> statement-breakpoint
ALTER TABLE "namespace_tool_mappings" ADD COLUMN "defer_loading" "defer_loading_behavior" DEFAULT 'INHERIT' NOT NULL;--> statement-breakpoint
ALTER TABLE "namespaces" ADD COLUMN "default_defer_loading" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "namespaces" ADD COLUMN "default_search_method" "tool_search_method" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_search_config" ADD CONSTRAINT "tool_search_config_namespace_uuid_namespaces_uuid_fk" FOREIGN KEY ("namespace_uuid") REFERENCES "public"."namespaces"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tool_search_config_namespace_uuid_idx" ON "tool_search_config" USING btree ("namespace_uuid");