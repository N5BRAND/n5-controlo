CREATE TABLE "meta_abo_campaigns" (
	"campaign_id" text PRIMARY KEY NOT NULL,
	"software_id" text NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"daily_budget_cents" integer NOT NULL,
	"abo_since" date NOT NULL,
	"auto" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_budget_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"moment" text NOT NULL,
	"campaign_id" text NOT NULL,
	"adset_id" text,
	"adset_name" text,
	"ad_name" text,
	"action" text NOT NULL,
	"from_cents" integer,
	"to_cents" integer,
	"metric" text,
	"cost_cents" integer,
	"reason" text NOT NULL,
	"incoming" text,
	"applied" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_daily" ADD COLUMN "adset_id" text;--> statement-breakpoint
ALTER TABLE "campaign_daily" ADD COLUMN "ad_id" text;--> statement-breakpoint
ALTER TABLE "campaign_daily" ADD COLUMN "landing_views" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_daily" ADD COLUMN "purchases" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_abo_campaigns" ADD CONSTRAINT "meta_abo_campaigns_software_id_softwares_id_fk" FOREIGN KEY ("software_id") REFERENCES "public"."softwares"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meta_budget_decisions_campaign" ON "meta_budget_decisions" USING btree ("campaign_id","created_at");