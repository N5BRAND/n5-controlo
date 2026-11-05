CREATE TABLE "meta_consents" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"software_id" text NOT NULL,
	"lead_event_id" text,
	"fbp" text,
	"fbc" text,
	"client_ip" text,
	"user_agent" text,
	"source_url" text,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"purchase_sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "meta_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meta_consents" ADD CONSTRAINT "meta_consents_software_id_softwares_id_fk" FOREIGN KEY ("software_id") REFERENCES "public"."softwares"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meta_consents_expires_idx" ON "meta_consents" USING btree ("expires_at");