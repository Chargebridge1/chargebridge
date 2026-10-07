CREATE TYPE "public"."org_role" AS ENUM('admin', 'manager', 'supervisor', 'driver', 'analyst', 'technician', 'finance', 'regional_manager');--> statement-breakpoint
CREATE TYPE "public"."charger_type" AS ENUM('Level1', 'Level2', 'DCFC');--> statement-breakpoint
CREATE TYPE "public"."station_status" AS ENUM('available', 'busy', 'offline', 'pending', 'removed');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'paid', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."charging_state" AS ENUM('not_started', 'remote_start_sent', 'charging', 'remote_stop_sent', 'stopped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_state" AS ENUM('pending', 'authorized', 'captured', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('pending', 'stopping', 'completed', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."operator_app_status" AS ENUM('pending', 'reviewing', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."review_action" AS ENUM('approved', 'rejected', 'reviewing', 'pending');--> statement-breakpoint
CREATE TYPE "public"."review_entity_type" AS ENUM('station', 'operator_application');--> statement-breakpoint
CREATE TABLE "org_memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"clerk_user_id" text,
	"email" text NOT NULL,
	"name" text,
	"role" "org_role" DEFAULT 'driver' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"owner_clerk_id" text NOT NULL,
	"plan" text DEFAULT 'fleet' NOT NULL,
	"logo_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"country" text DEFAULT 'United States' NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"charger_type" charger_type NOT NULL,
	"power_kw" real NOT NULL,
	"price_per_kwh" real NOT NULL,
	"total_ports" integer DEFAULT 1 NOT NULL,
	"available_ports" integer DEFAULT 1 NOT NULL,
	"status" "station_status" DEFAULT 'pending' NOT NULL,
	"description" text,
	"network" text,
	"photo_url" text,
	"ocpp_charge_point_id" text,
	"ocpp_password" text,
	"owner_clerk_user_id" text,
	"cpo_org_id" integer,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"admin_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" integer NOT NULL,
	"clerk_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_id" integer NOT NULL,
	"author_name" text NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"clerk_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_station_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"author_name" text NOT NULL,
	"clerk_user_id" text,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_id" integer,
	"external_station_id" text,
	"external_station_data" jsonb,
	"clerk_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"amount" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_clerk_id" text,
	"invoice_number" text NOT NULL,
	"business_name" text NOT NULL,
	"business_email" text NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"due_date" timestamp NOT NULL,
	"notes" text,
	"charging_session_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "charging_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_id" integer,
	"station_name" text,
	"driver_email" text NOT NULL,
	"driver_name" text NOT NULL,
	"kwh" real NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" "session_status" DEFAULT 'pending' NOT NULL,
	"stripe_payment_intent_id" text,
	"stripe_checkout_session_id" text,
	"stripe_refund_id" text,
	"clerk_user_id" text,
	"guest_token_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"stop_initiated_at" timestamp,
	"payment_state" "payment_state",
	"charging_state" charging_state,
	"ocpp_transaction_id" integer
);
--> statement-breakpoint
CREATE TABLE "operator_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"charger_brand" text NOT NULL,
	"charger_model" text,
	"ocpp_version" text,
	"current_network" text,
	"station_count" text,
	"locations" text,
	"notes" text,
	"status" "operator_app_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"admin_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"clerk_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"vehicle_make" text,
	"vehicle_model" text,
	"vehicle_year" text,
	"connector_type" text,
	"battery_kwh" real,
	"range_per_charge" real,
	"fuel_type" text,
	"mpg" real,
	"preferences" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "charging_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"station_id" text,
	"station_name" text NOT NULL,
	"station_address" text,
	"charger_type" text,
	"kwh" real,
	"amount_cents" integer,
	"currency" text DEFAULT 'usd',
	"charged_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gas_station_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"osm_id" text NOT NULL,
	"author_name" text NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_driver_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" serial NOT NULL,
	"driver_email" text NOT NULL,
	"driver_name" text,
	"assigned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_clerk_id" text NOT NULL,
	"organization_id" integer,
	"nickname" text NOT NULL,
	"make" text,
	"model" text,
	"year" text,
	"license_plate" text,
	"vin" text,
	"color" text,
	"department" text,
	"battery_kwh" real,
	"range_per_charge" real,
	"connector_type" text,
	"status" "vehicle_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "station_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_id" integer NOT NULL,
	"clerk_user_id" text NOT NULL,
	"photo_url" text NOT NULL,
	"caption" text,
	"photo_type" text DEFAULT 'station' NOT NULL,
	"business_name" text,
	"business_lat" real,
	"business_lng" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "station_checkins" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_id" integer NOT NULL,
	"clerk_user_id" text NOT NULL,
	"port_number" integer,
	"checked_in_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "saved_trips" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"name" text NOT NULL,
	"origin_label" text NOT NULL,
	"origin_lat" real NOT NULL,
	"origin_lng" real NOT NULL,
	"dest_label" text NOT NULL,
	"dest_lat" real NOT NULL,
	"dest_lng" real NOT NULL,
	"range_km" integer DEFAULT 300 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "station_status_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_id" text NOT NULL,
	"report_type" text NOT NULL,
	"clerk_user_id" text,
	"confirmations" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"nickname" text,
	"make" text,
	"model" text,
	"year" text,
	"connector_type" text,
	"battery_kwh" real,
	"range_per_charge" real,
	"fuel_type" text,
	"mpg" real,
	"is_primary" boolean DEFAULT false NOT NULL,
	"plug_types" text[],
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"catalog_trim_id" integer
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_clerk_id" text NOT NULL,
	"member_email" text NOT NULL,
	"member_clerk_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" "review_entity_type" NOT NULL,
	"entity_id" serial NOT NULL,
	"entity_name" text,
	"admin_clerk_id" text NOT NULL,
	"admin_name" text,
	"action" "review_action" NOT NULL,
	"previous_action" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviewer_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"granted_by" text NOT NULL,
	"granted_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reviewer_access_clerk_id_unique" UNIQUE("clerk_id")
);
--> statement-breakpoint
CREATE TABLE "ocpi_parties" (
	"id" serial PRIMARY KEY NOT NULL,
	"country_code" text NOT NULL,
	"party_id" text NOT NULL,
	"role" text NOT NULL,
	"business_details" jsonb,
	"inbound_token" text NOT NULL,
	"outbound_token" text,
	"versions_url" text,
	"module_urls" jsonb,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ocpi_parties_inbound_token_unique" UNIQUE("inbound_token")
);
--> statement-breakpoint
CREATE TABLE "ocpi_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"country_code" text NOT NULL,
	"party_id" text NOT NULL,
	"uid" text NOT NULL,
	"type" text DEFAULT 'RFID' NOT NULL,
	"contract_id" text NOT NULL,
	"visual_number" text,
	"issuer" text NOT NULL,
	"group_id" text,
	"valid" boolean DEFAULT true NOT NULL,
	"whitelist" text DEFAULT 'ALLOWED' NOT NULL,
	"language" text,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ocpi_tokens_uid_unique" UNIQUE("country_code","party_id","uid")
);
--> statement-breakpoint
CREATE TABLE "ocpi_tariffs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tariff_id" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"type" text,
	"elements" jsonb NOT NULL,
	"station_id" integer,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ocpi_tariffs_tariff_id_unique" UNIQUE("tariff_id")
);
--> statement-breakpoint
CREATE TABLE "ocpi_cdrs" (
	"id" serial PRIMARY KEY NOT NULL,
	"cdr_id" text NOT NULL,
	"country_code" text NOT NULL,
	"party_id" text NOT NULL,
	"session_id" integer,
	"start_date_time" timestamp NOT NULL,
	"end_date_time" timestamp NOT NULL,
	"cdr_token" jsonb NOT NULL,
	"auth_method" text DEFAULT 'AUTH_REQUEST' NOT NULL,
	"location_id" text NOT NULL,
	"evse_uid" text NOT NULL,
	"connector_id" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"charging_periods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_cost" jsonb NOT NULL,
	"total_energy" real NOT NULL,
	"total_time" real NOT NULL,
	"raw" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ocpi_cdrs_cdr_id_unique" UNIQUE("cdr_id")
);
--> statement-breakpoint
CREATE TABLE "profile_changelog" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"device_type" text NOT NULL,
	"field_group" text NOT NULL,
	"change_summary" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"stripe_event_id" text NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_events_stripe_event_id_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
CREATE TABLE "pricing_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"changed_by_clerk_id" text NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"field" text NOT NULL,
	"previous_value" text,
	"new_value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_otps" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_clerk_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" integer,
	"target_name" text,
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_role_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_clerk_id" text NOT NULL,
	"actor_name" text,
	"target_clerk_id" text NOT NULL,
	"target_email" text NOT NULL,
	"target_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_refund_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"payment_intent_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"reason" text NOT NULL,
	"job_type" text DEFAULT 'refund' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"succeeded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_refund_jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ranking_weights" (
	"category" text PRIMARY KEY NOT NULL,
	"weight" real NOT NULL,
	"description" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "station_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"station_id" integer,
	"type" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"message" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ev_catalog" (
	"id" serial PRIMARY KEY NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year_from" integer,
	"year_to" integer,
	"year_display" text NOT NULL,
	"trim" text,
	"fuel_category" text NOT NULL,
	"dc_connector" text,
	"ac_connector" text,
	"battery_kwh" real,
	"ac_max_kw" real,
	"dc_max_kw" real,
	"range_miles" integer,
	"typical_mpg" real,
	"source" text DEFAULT 'seed' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ev_charging_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"trim_id" integer NOT NULL,
	"dc_connector" text,
	"ac_connector" text,
	"battery_kwh" real,
	"usable_kwh" real,
	"ac_max_kw" real,
	"onboard_charger_kw" real,
	"dc_max_kw" real,
	"range_miles" integer,
	"typical_mpg" real,
	"plug_and_charge" boolean DEFAULT false NOT NULL,
	"supercharger_eligible" boolean DEFAULT false NOT NULL,
	"charge_curve_json" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ev_charging_profiles_trim_id_unique" UNIQUE("trim_id")
);
--> statement-breakpoint
CREATE TABLE "ev_manufacturers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ev_manufacturers_name_unique" UNIQUE("name"),
	CONSTRAINT "ev_manufacturers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ev_model_years" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_id" integer NOT NULL,
	"year" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ev_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"manufacturer_id" integer NOT NULL,
	"name" text NOT NULL,
	"body_style" text,
	"segment" text,
	"fuel_category" text DEFAULT 'BEV' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ev_trims" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_year_id" integer NOT NULL,
	"trim_name" text DEFAULT '' NOT NULL,
	"msrp_usd" integer,
	"source" text DEFAULT 'seed' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_catalog_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"version_tag" text NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"trim_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_catalog_versions_version_tag_unique" UNIQUE("version_tag")
);
--> statement-breakpoint
CREATE TABLE "connector_affinities" (
	"clerk_user_id" text NOT NULL,
	"connector_type" text NOT NULL,
	"weight" real DEFAULT 0 NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_affinities_clerk_user_id_connector_type_pk" PRIMARY KEY("clerk_user_id","connector_type")
);
--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_clerk_user_id_users_clerk_id_fk" FOREIGN KEY ("clerk_user_id") REFERENCES "public"."users"("clerk_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_clerk_id_users_clerk_id_fk" FOREIGN KEY ("owner_clerk_id") REFERENCES "public"."users"("clerk_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charging_history" ADD CONSTRAINT "charging_history_clerk_user_id_users_clerk_id_fk" FOREIGN KEY ("clerk_user_id") REFERENCES "public"."users"("clerk_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_assignments" ADD CONSTRAINT "fleet_driver_assignments_vehicle_id_fleet_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fleet_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_owner_clerk_id_users_clerk_id_fk" FOREIGN KEY ("owner_clerk_id") REFERENCES "public"."users"("clerk_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_photos" ADD CONSTRAINT "station_photos_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_checkins" ADD CONSTRAINT "station_checkins_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocpi_tariffs" ADD CONSTRAINT "ocpi_tariffs_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocpi_cdrs" ADD CONSTRAINT "ocpi_cdrs_session_id_charging_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."charging_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_charging_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."charging_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ev_charging_profiles" ADD CONSTRAINT "ev_charging_profiles_trim_id_ev_trims_id_fk" FOREIGN KEY ("trim_id") REFERENCES "public"."ev_trims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ev_model_years" ADD CONSTRAINT "ev_model_years_model_id_ev_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ev_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ev_models" ADD CONSTRAINT "ev_models_manufacturer_id_ev_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."ev_manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ev_trims" ADD CONSTRAINT "ev_trims_model_year_id_ev_model_years_id_fk" FOREIGN KEY ("model_year_id") REFERENCES "public"."ev_model_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_affinities" ADD CONSTRAINT "connector_affinities_clerk_user_id_users_clerk_id_fk" FOREIGN KEY ("clerk_user_id") REFERENCES "public"."users"("clerk_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_station_reviews_external_id_idx" ON "external_station_reviews" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "gas_station_reviews_osm_id_idx" ON "gas_station_reviews" USING btree ("osm_id");--> statement-breakpoint
CREATE INDEX "ev_catalog_make_idx" ON "ev_catalog" USING btree ("make");--> statement-breakpoint
CREATE INDEX "ev_catalog_make_model_idx" ON "ev_catalog" USING btree ("make","model");--> statement-breakpoint
CREATE INDEX "ev_catalog_fuel_idx" ON "ev_catalog" USING btree ("fuel_category");--> statement-breakpoint
CREATE INDEX "ev_catalog_active_idx" ON "ev_catalog" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "ev_cp_trim_idx" ON "ev_charging_profiles" USING btree ("trim_id");--> statement-breakpoint
CREATE INDEX "ev_cp_dc_idx" ON "ev_charging_profiles" USING btree ("dc_connector");--> statement-breakpoint
CREATE INDEX "ev_cp_sc_idx" ON "ev_charging_profiles" USING btree ("supercharger_eligible");--> statement-breakpoint
CREATE INDEX "ev_cp_pac_idx" ON "ev_charging_profiles" USING btree ("plug_and_charge");--> statement-breakpoint
CREATE INDEX "ev_mfr_active_idx" ON "ev_manufacturers" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "ev_model_years_unique_idx" ON "ev_model_years" USING btree ("model_id","year");--> statement-breakpoint
CREATE INDEX "ev_model_years_model_idx" ON "ev_model_years" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "ev_model_years_year_idx" ON "ev_model_years" USING btree ("year");--> statement-breakpoint
CREATE INDEX "ev_model_years_active_idx" ON "ev_model_years" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "ev_models_mfr_name_idx" ON "ev_models" USING btree ("manufacturer_id","name");--> statement-breakpoint
CREATE INDEX "ev_models_fuel_idx" ON "ev_models" USING btree ("fuel_category");--> statement-breakpoint
CREATE INDEX "ev_models_mfr_idx" ON "ev_models" USING btree ("manufacturer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ev_trims_unique_idx" ON "ev_trims" USING btree ("model_year_id","trim_name");--> statement-breakpoint
CREATE INDEX "ev_trims_model_year_idx" ON "ev_trims" USING btree ("model_year_id");--> statement-breakpoint
CREATE INDEX "ev_trims_active_idx" ON "ev_trims" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "vcv_current_idx" ON "vehicle_catalog_versions" USING btree ("is_current");--> statement-breakpoint
CREATE INDEX "vcv_released_idx" ON "vehicle_catalog_versions" USING btree ("released_at");--> statement-breakpoint
CREATE INDEX "session_events_session_id_idx" ON "session_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_events_event_type_idx" ON "session_events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_charging_session_id_unique" ON "invoices" USING btree ("charging_session_id") WHERE "charging_session_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE platform_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);--> statement-breakpoint
CREATE TABLE gas_prices (
  id SERIAL PRIMARY KEY,
  osm_id TEXT NOT NULL,
  regular_cents INTEGER,
  mid_cents INTEGER,
  premium_cents INTEGER,
  diesel_cents INTEGER,
  reporter_name TEXT,
  reported_at TIMESTAMP NOT NULL DEFAULT NOW()
);--> statement-breakpoint
CREATE INDEX gas_prices_osm_id_idx ON gas_prices (osm_id);--> statement-breakpoint
CREATE TABLE button_configs (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  platform TEXT NOT NULL,
  location TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);--> statement-breakpoint
INSERT INTO button_configs (key, label, platform, location, description, enabled) VALUES
('mobile_dashboard_find_nearby', 'Find Nearby', 'mobile', 'Dashboard', 'Quick action to find nearby EV chargers', TRUE),
('mobile_dashboard_explore', 'Explore', 'mobile', 'Dashboard', 'Quick action to explore stations by city/zip', TRUE),
('mobile_dashboard_add_station', 'Add Station', 'mobile', 'Dashboard', 'Quick action to add a new community station', TRUE),
('mobile_dashboard_charge_now', 'Charge Now', 'mobile', 'Dashboard', 'Quick action to open the Charge Now flow', TRUE),
('mobile_dashboard_live_map', 'Live Map', 'mobile', 'Dashboard', 'Quick action to view all stations on the live map', TRUE),
('mobile_dashboard_gas_prices', 'Gas Prices', 'mobile', 'Dashboard', 'Quick action for community gas price tracker', TRUE),
('mobile_dashboard_membership', 'Membership', 'mobile', 'Dashboard', 'Quick action to view membership plans and pricing', TRUE),
('mobile_dashboard_app_reviews', 'App Reviews', 'mobile', 'Dashboard', 'Quick action to open app store reviews page', TRUE),
('mobile_header_home_button', 'Home Button', 'mobile', 'Tab Headers', 'Home navigation button shown in each tab''s header bar', TRUE),
('mobile_header_charge_now', 'Charge Now Button', 'mobile', 'Tab Headers', 'Charge Now shortcut button in Nearby and Explore tab headers', TRUE),
('web_sidebar_charge_now', 'Charge Now', 'web', 'Sidebar', 'Charge Now CTA button in the sidebar footer', TRUE),
('web_sidebar_share', 'Share App', 'web', 'Sidebar', 'Share App button in the sidebar footer', TRUE),
('web_nav_add_station', 'Add Station', 'web', 'Navigation', 'Add Station link in the sidebar navigation', TRUE),
('web_nav_gas_stations', 'Gas Stations', 'web', 'Navigation', 'Gas Stations link in the sidebar navigation', TRUE),
('web_nav_membership', 'Membership', 'web', 'Navigation', 'Membership link in the sidebar navigation', TRUE),
('web_nav_live_map', 'Live Map', 'web', 'Navigation', 'Live Map link in the sidebar navigation', TRUE),
('web_station_favorite', 'Favorite Button', 'web', 'Station Cards', 'Favorite / unfavorite heart button on each station card', TRUE),
('web_station_review', 'Rate Button', 'web', 'Station Cards', 'Star rating / review button on each station card', TRUE),
('web_page_stations', 'Stations List', 'web', 'Pages', 'Browse all community EV charging stations', TRUE),
('web_page_nearby', 'Nearby Search', 'web', 'Pages', 'Find EV stations near a specific location', TRUE),
('web_page_map', 'Live Map', 'web', 'Pages', 'Interactive map showing all stations in real time', TRUE),
('web_page_favorites', 'Favorites', 'web', 'Pages', 'Users'' saved favorite stations', TRUE),
('web_page_add_station', 'Add New Station', 'web', 'Pages', 'Community form to submit a new charging station', TRUE),
('web_page_invoices', 'Invoices', 'web', 'Pages', 'Charging session invoices and billing history', TRUE),
('web_page_gas_stations', 'Gas Stations', 'web', 'Pages', 'Community-reported gas price tracker', TRUE),
('web_page_membership', 'Membership Plans', 'web', 'Pages', 'Subscription plan options and pricing', TRUE);