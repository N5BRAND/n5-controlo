-- Novos estágios do Pipeline. As tarefas existentes não se apagam: as fases antigas passam para as novas
-- (ideia, descoberta e design -> sprint_backlog; desenvolvimento -> in_progress; testes -> testing_beta;
-- staging -> testing_staging; producao -> done).
CREATE TYPE "public"."roadmap_priority" AS ENUM('urgente', 'alta', 'normal', 'baixa');--> statement-breakpoint
CREATE TABLE "roadmap_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roadmap_items" ALTER COLUMN "phase" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "roadmap_items" ALTER COLUMN "phase" SET DEFAULT 'sprint_backlog'::text;--> statement-breakpoint
DROP TYPE "public"."roadmap_phase";--> statement-breakpoint
CREATE TYPE "public"."roadmap_phase" AS ENUM('sprint_backlog', 'in_progress', 'paused', 'homologation_review_beta', 'code_review_beta', 'ready4test_beta', 'testing_beta', 'validated_beta', 'to_deploy_staging', 'ready4test_staging', 'testing_staging', 'awaiting_fix_staging', 'validated_staging', 'ready4test_prod', 'testing_prod', 'done', 'canceled');--> statement-breakpoint
ALTER TABLE "roadmap_items" ALTER COLUMN "phase" SET DEFAULT 'sprint_backlog'::"public"."roadmap_phase";--> statement-breakpoint
ALTER TABLE "roadmap_items" ALTER COLUMN "phase" SET DATA TYPE "public"."roadmap_phase" USING (CASE "phase" WHEN 'ideia' THEN 'sprint_backlog' WHEN 'descoberta' THEN 'sprint_backlog' WHEN 'design' THEN 'sprint_backlog' WHEN 'desenvolvimento' THEN 'in_progress' WHEN 'testes' THEN 'testing_beta' WHEN 'staging' THEN 'testing_staging' WHEN 'producao' THEN 'done' ELSE "phase" END)::"public"."roadmap_phase";--> statement-breakpoint
ALTER TABLE "roadmap_items" ADD COLUMN "priority" "roadmap_priority" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "roadmap_comments" ADD CONSTRAINT "roadmap_comments_item_id_roadmap_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."roadmap_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_comments" ADD CONSTRAINT "roadmap_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roadmap_comments_item_idx" ON "roadmap_comments" USING btree ("item_id","created_at");