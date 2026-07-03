ALTER TABLE "agent_documents" ADD COLUMN "repo_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_documents" ADD COLUMN "repo_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_documents" ADD CONSTRAINT "skill_documents_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_documents_repo_idx" ON "agent_documents" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "skill_documents_repo_idx" ON "skill_documents" USING btree ("repo_id");