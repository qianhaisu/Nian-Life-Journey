CREATE TABLE "media_rejections" (
	"id" text PRIMARY KEY NOT NULL,
	"media_id" text,
	"checksum" text,
	"category" text NOT NULL,
	"reason_code" text,
	"rejected_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "media_rejections_media_id_unique" ON "media_rejections" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_rejections_checksum_unique" ON "media_rejections" USING btree ("checksum");