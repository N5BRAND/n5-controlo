CREATE TYPE "public"."roadmap_priority" AS ENUM('urgente', 'alta', 'normal', 'baixa');--> statement-breakpoint
CREATE TABLE "roadmap_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roadmap_items" ADD COLUMN "priority" "roadmap_priority" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "roadmap_comments" ADD CONSTRAINT "roadmap_comments_item_id_roadmap_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."roadmap_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_comments" ADD CONSTRAINT "roadmap_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roadmap_comments_item_idx" ON "roadmap_comments" USING btree ("item_id","created_at");