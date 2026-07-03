DELETE FROM "agent_documents" WHERE "repo_id" IS NULL;--> statement-breakpoint
DELETE FROM "skill_documents" WHERE "repo_id" IS NULL;--> statement-breakpoint
ALTER TABLE "agent_documents" DROP CONSTRAINT "agent_documents_agent_id_path_pk";--> statement-breakpoint
ALTER TABLE "skill_documents" DROP CONSTRAINT "skill_documents_skill_id_path_pk";--> statement-breakpoint
ALTER TABLE "agent_documents" ALTER COLUMN "repo_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_documents" ALTER COLUMN "repo_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_agent_id_repo_id_path_pk" PRIMARY KEY("agent_id","repo_id","path");--> statement-breakpoint
ALTER TABLE "skill_documents" ADD CONSTRAINT "skill_documents_skill_id_repo_id_path_pk" PRIMARY KEY("skill_id","repo_id","path");