-- Novos estágios do Pipeline: as tarefas antigas (fases antigas) são apagadas.
UPDATE "feedback" SET "roadmap_item_id" = NULL;--> statement-breakpoint
UPDATE "pull_requests" SET "roadmap_item_id" = NULL;--> statement-breakpoint
DELETE FROM "roadmap_items";--> statement-breakpoint
ALTER TABLE "roadmap_items" ALTER COLUMN "phase" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "roadmap_items" ALTER COLUMN "phase" SET DEFAULT 'sprint_backlog'::text;--> statement-breakpoint
DROP TYPE "public"."roadmap_phase";--> statement-breakpoint
CREATE TYPE "public"."roadmap_phase" AS ENUM('sprint_backlog', 'in_progress', 'paused', 'homologation_review_beta', 'code_review_beta', 'ready4test_beta', 'testing_beta', 'validated_beta', 'to_deploy_staging', 'ready4test_staging', 'testing_staging', 'awaiting_fix_staging', 'validated_staging', 'ready4test_prod', 'testing_prod', 'done', 'canceled');--> statement-breakpoint
ALTER TABLE "roadmap_items" ALTER COLUMN "phase" SET DEFAULT 'sprint_backlog'::"public"."roadmap_phase";--> statement-breakpoint
ALTER TABLE "roadmap_items" ALTER COLUMN "phase" SET DATA TYPE "public"."roadmap_phase" USING "phase"::"public"."roadmap_phase";