CREATE TABLE "edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"dt_id" text NOT NULL,
	"from_pole" text NOT NULL,
	"to_pole" text NOT NULL,
	"source" text NOT NULL,
	"confidence" numeric DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edges_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"pole_a" text NOT NULL,
	"pole_b" text NOT NULL,
	"co_dark_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feeders" (
	"id" text PRIMARY KEY NOT NULL,
	"substation_id" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"scope" text NOT NULL,
	"confidence" numeric NOT NULL,
	"dt_id" text,
	"feeder_id" text NOT NULL,
	"from_pole" text,
	"to_pole" text,
	"coords_lat" numeric,
	"coords_lon" numeric,
	"pincode" text,
	"affected_pole_ids" jsonb NOT NULL,
	"affected_households" integer NOT NULL,
	"reason" text,
	"ai_brief" text
);
--> statement-breakpoint
CREATE TABLE "pole_states" (
	"pole_id" text PRIMARY KEY NOT NULL,
	"energized" boolean DEFAULT true NOT NULL,
	"known" boolean DEFAULT false NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"last_power_lost_at" timestamp with time zone,
	"last_power_restored_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poles" (
	"id" text PRIMARY KEY NOT NULL,
	"lat" numeric NOT NULL,
	"lon" numeric NOT NULL,
	"feeder_id" text NOT NULL,
	"dt_id" text NOT NULL,
	"seq_on_line" integer,
	"parent_pole_id" text,
	"pole_type" text NOT NULL,
	"ward" text NOT NULL,
	"pincode" text,
	"device_id" text
);
--> statement-breakpoint
CREATE TABLE "scheduled_outages" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"target_id" text NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"pole_id" text NOT NULL,
	"event" text NOT NULL,
	"energized" boolean NOT NULL,
	"seq" integer NOT NULL,
	"fw" text NOT NULL,
	"recv_at" timestamp with time zone NOT NULL,
	"event_ts" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"status" text NOT NULL,
	"timeline" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transformers" (
	"id" text PRIMARY KEY NOT NULL,
	"feeder_id" text NOT NULL,
	"lat" numeric NOT NULL,
	"lon" numeric NOT NULL,
	"capacity_kva" integer NOT NULL,
	"households_served" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "edges_dt_idx" ON "edges" USING btree ("dt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "edges_unique" ON "edges" USING btree ("dt_id","from_pole","to_pole");--> statement-breakpoint
CREATE INDEX "feeders_substation_idx" ON "feeders" USING btree ("substation_id");--> statement-breakpoint
CREATE INDEX "poles_dt_idx" ON "poles" USING btree ("dt_id");--> statement-breakpoint
CREATE INDEX "poles_feeder_idx" ON "poles" USING btree ("feeder_id");--> statement-breakpoint
CREATE INDEX "poles_parent_idx" ON "poles" USING btree ("parent_pole_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telemetry_uniq" ON "telemetry_events" USING btree ("device_id","seq");--> statement-breakpoint
CREATE INDEX "telemetry_recv_idx" ON "telemetry_events" USING btree ("recv_at");--> statement-breakpoint
CREATE INDEX "telemetry_replied_pole_idx" ON "telemetry_events" USING btree ("pole_id");