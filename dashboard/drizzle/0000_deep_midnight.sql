CREATE TYPE "public"."build_check_status" AS ENUM('missing', 'pr_open', 'active', 'own_ci');--> statement-breakpoint
CREATE TYPE "public"."change_request_state" AS ENUM('open', 'merged', 'closed');--> statement-breakpoint
CREATE TYPE "public"."ci_status" AS ENUM('success', 'failure', 'pending', 'none');--> statement-breakpoint
CREATE TYPE "public"."job_result" AS ENUM('success', 'failed', 'skipped', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_trigger" AS ENUM('schedule', 'webhook', 'manual');--> statement-breakpoint
CREATE TYPE "public"."onboarding_status" AS ENUM('none', 'pr_open', 'onboarded', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('github', 'gitlab');--> statement-breakpoint
CREATE TYPE "public"."problem_kind" AS ENUM('config_error', 'lockfile_failure', 'job_failed', 'stale_pr', 'ci_red', 'missing_build_check');--> statement-breakpoint
CREATE TYPE "public"."rollout_kind" AS ENUM('onboarding', 'build_check');--> statement-breakpoint
CREATE TYPE "public"."rollout_status" AS ENUM('pending', 'pr_open', 'merged', 'failed', 'closed');--> statement-breakpoint
CREATE TYPE "public"."update_type" AS ENUM('major', 'minor', 'patch', 'security', 'digest', 'lockfile', 'other');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "http_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"etag" text NOT NULL,
	"body" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"owner_name" text NOT NULL,
	"installation_id" bigint,
	"auto_onboarding" boolean DEFAULT false NOT NULL,
	"auto_onboarding_enabled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"kind" "problem_kind" NOT NULL,
	"message" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"dedupe_key" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"update_type" "update_type" DEFAULT 'other' NOT NULL,
	"package_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"ci_status" "ci_status" DEFAULT 'none' NOT NULL,
	"automerge" boolean DEFAULT false NOT NULL,
	"state" "change_request_state" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"merged_at" timestamp with time zone,
	"head_sha" text,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renovate_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"ce_job_id" text NOT NULL,
	"trigger" "job_trigger" NOT NULL,
	"status" "job_status" NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"log_excerpt" text,
	"reason" text,
	"error_message" text,
	"status_raw" text
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"onboarding_status" "onboarding_status" DEFAULT 'none' NOT NULL,
	"build_check_status" "build_check_status" DEFAULT 'missing' NOT NULL,
	"detected_ecosystems" text[] DEFAULT '{}'::text[] NOT NULL,
	"dependency_dashboard_url" text,
	"last_job_at" timestamp with time zone,
	"last_job_result" "job_result" DEFAULT 'unknown' NOT NULL,
	"synced_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"head_sha" text,
	"config_path" text,
	"ce_status" text,
	"own_ci" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rollout_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"kind" "rollout_kind" NOT NULL,
	"triggered_by" text NOT NULL,
	"pr_url" text,
	"pr_number" integer,
	"status" "rollout_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"source" text PRIMARY KEY NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_message" text,
	"partial_errors" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_connections" ADD CONSTRAINT "platform_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renovate_jobs" ADD CONSTRAINT "renovate_jobs_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_connection_id_platform_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."platform_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollout_actions" ADD CONSTRAINT "rollout_actions_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_connections_tenant_platform_owner_key" ON "platform_connections" USING btree ("tenant_id","platform","owner_name");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_connections_platform_installation_key" ON "platform_connections" USING btree ("platform","installation_id") WHERE "platform_connections"."installation_id" is not null;--> statement-breakpoint
CREATE INDEX "platform_connections_tenant_id_idx" ON "platform_connections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "problems_repository_id_idx" ON "problems" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "problems_open_key" ON "problems" USING btree ("repository_id","kind","dedupe_key") WHERE "problems"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_repository_number_key" ON "pull_requests" USING btree ("repository_id","number");--> statement-breakpoint
CREATE INDEX "pull_requests_repository_id_idx" ON "pull_requests" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "pull_requests_repository_state_idx" ON "pull_requests" USING btree ("repository_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "renovate_jobs_ce_job_id_key" ON "renovate_jobs" USING btree ("ce_job_id");--> statement-breakpoint
CREATE INDEX "renovate_jobs_repository_id_idx" ON "renovate_jobs" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "renovate_jobs_repository_started_at_idx" ON "renovate_jobs" USING btree ("repository_id","started_at");--> statement-breakpoint
CREATE INDEX "renovate_jobs_status_idx" ON "renovate_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_connection_external_id_key" ON "repositories" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "repositories_connection_full_name_idx" ON "repositories" USING btree ("connection_id","full_name");--> statement-breakpoint
CREATE INDEX "repositories_connection_id_idx" ON "repositories" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "rollout_actions_repository_id_idx" ON "rollout_actions" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "rollout_actions_repository_kind_status_idx" ON "rollout_actions" USING btree ("repository_id","kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rollout_actions_open_key" ON "rollout_actions" USING btree ("repository_id","kind") WHERE "rollout_actions"."status" in ('pending', 'pr_open');--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_name_key" ON "tenants" USING btree ("name");