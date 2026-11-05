CREATE TABLE "meta_ads" (
	"ad_id" text PRIMARY KEY NOT NULL,
	"software_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"adset_name" text,
	"status" text,
	"format" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_campaign_totals" (
	"campaign_id" text PRIMARY KEY NOT NULL,
	"software_id" text NOT NULL,
	"since" date,
	"until" date,
	"spend_cents" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"frequency" numeric(6, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_daily" ADD COLUMN "checkouts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_software_id_softwares_id_fk" FOREIGN KEY ("software_id") REFERENCES "public"."softwares"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_campaign_totals" ADD CONSTRAINT "meta_campaign_totals_software_id_softwares_id_fk" FOREIGN KEY ("software_id") REFERENCES "public"."softwares"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meta_ads_campaign_idx" ON "meta_ads" USING btree ("campaign_id");