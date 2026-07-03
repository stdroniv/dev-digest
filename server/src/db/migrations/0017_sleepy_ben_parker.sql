CREATE TABLE "why_risk_brief" (
	"pr_id" uuid PRIMARY KEY NOT NULL,
	"brief" jsonb NOT NULL,
	"docs_truncated" boolean DEFAULT false NOT NULL,
	"degraded_inputs" jsonb,
	"inputs_fingerprint" text NOT NULL,
	"model" text,
	"cost_usd" numeric,
	"tokens_in" integer,
	"tokens_out" integer,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "why_risk_brief" ADD CONSTRAINT "why_risk_brief_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;