CREATE TABLE "signup_attributions" (
	"email_hash" text NOT NULL,
	"software_id" text NOT NULL,
	"page" text,
	"ad_ref" text,
	"signed_up_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signup_attributions_email_hash_software_id_pk" PRIMARY KEY("email_hash","software_id")
);
--> statement-breakpoint
ALTER TABLE "signup_attributions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stripe_purchases" (
	"session_id" text PRIMARY KEY NOT NULL,
	"software_id" text NOT NULL,
	"email_hash" text,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'eur' NOT NULL,
	"payment_link" text,
	"paid_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stripe_purchases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD COLUMN "ad_ref" text;--> statement-breakpoint
ALTER TABLE "signup_attributions" ADD CONSTRAINT "signup_attributions_software_id_softwares_id_fk" FOREIGN KEY ("software_id") REFERENCES "public"."softwares"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_purchases" ADD CONSTRAINT "stripe_purchases_software_id_softwares_id_fk" FOREIGN KEY ("software_id") REFERENCES "public"."softwares"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stripe_purchases_sw_idx" ON "stripe_purchases" USING btree ("software_id","paid_at");