ALTER TABLE "agent_documents" DROP CONSTRAINT "agent_documents_repo_id_repos_id_fk";
--> statement-breakpoint
ALTER TABLE "skill_documents" DROP CONSTRAINT "skill_documents_repo_id_repos_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_documents" ADD CONSTRAINT "skill_documents_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;