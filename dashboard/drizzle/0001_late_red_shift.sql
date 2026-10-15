ALTER TABLE "renovate_jobs" ADD COLUMN "artifact_error_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "paused_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "pause_note" text;