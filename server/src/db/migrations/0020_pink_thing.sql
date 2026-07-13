ALTER TABLE "ci_installations" ADD COLUMN "workflow_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "installed_config_hash" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "actions_run_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ci_runs_installation_actions_run_uq" ON "ci_runs" USING btree ("ci_installation_id","actions_run_id");