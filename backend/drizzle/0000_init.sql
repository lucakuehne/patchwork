CREATE TYPE "public"."auth_source" AS ENUM('local', 'ldap', 'oidc');--> statement-breakpoint
CREATE TYPE "public"."entry_kind" AS ENUM('reply', 'note', 'status', 'type', 'change');--> statement-breakpoint
CREATE TYPE "public"."item_source" AS ENUM('mail', 'portal', 'internal');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('incident', 'task');--> statement-breakpoint
CREATE TYPE "public"."mail_auth" AS ENUM('password', 'oauth2');--> statement-breakpoint
CREATE TYPE "public"."mail_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."status_category" AS ENUM('new', 'in_progress', 'waiting', 'done', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'it', 'standard');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"entry_id" uuid,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"content_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"author_id" uuid,
	"kind" "entry_kind" NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"body_html" text,
	"meta" jsonb,
	"mail_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('german'::regconfig, coalesce("entries"."body", ''))) STORED
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"type" "item_type",
	"status_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"description_html" text,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"creator_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"assignee_id" uuid,
	"mailbox_id" uuid,
	"source" "item_source" NOT NULL,
	"discarded" boolean DEFAULT false NOT NULL,
	"board_position" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('german'::regconfig, coalesce("items"."title", '')), 'A') || setweight(to_tsvector('german'::regconfig, coalesce("items"."description", '')), 'B')) STORED,
	CONSTRAINT "items_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "mail_messages" (
	"message_id" text PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"direction" "mail_direction" NOT NULL,
	"entry_id" uuid,
	"storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"imap_host" text NOT NULL,
	"imap_port" integer DEFAULT 993 NOT NULL,
	"imap_secure" boolean DEFAULT true NOT NULL,
	"imap_folder" text DEFAULT 'INBOX' NOT NULL,
	"smtp_host" text NOT NULL,
	"smtp_port" integer DEFAULT 587 NOT NULL,
	"smtp_security" text DEFAULT 'starttls' NOT NULL,
	"auth_type" "mail_auth" DEFAULT 'password' NOT NULL,
	"username" text NOT NULL,
	"password_enc" text,
	"oauth_token_url" text,
	"oauth_client_id" text,
	"oauth_client_secret_enc" text,
	"oauth_scope" text,
	"uid_validity" bigint,
	"last_uid" bigint DEFAULT 0 NOT NULL,
	"last_poll_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailboxes_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "mutes" (
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "mutes_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_item_id_user_id_pk" PRIMARY KEY("item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "item_type" NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"category" "status_category" NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statuses_type_key_uq" UNIQUE("type","key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" DEFAULT 'standard' NOT NULL,
	"auth_source" "auth_source" DEFAULT 'local' NOT NULL,
	"password_hash" text,
	"ldap_dn" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_status_id_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."statuses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutes" ADD CONSTRAINT "mutes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutes" ADD CONSTRAINT "mutes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_item_idx" ON "attachments" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "attachments_entry_idx" ON "attachments" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "entries_item_idx" ON "entries" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "entries_search_idx" ON "entries" USING gin ("search");--> statement-breakpoint
CREATE INDEX "items_type_idx" ON "items" USING btree ("type");--> statement-breakpoint
CREATE INDEX "items_status_idx" ON "items" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "items_assignee_idx" ON "items" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "items_reporter_idx" ON "items" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "items_search_idx" ON "items" USING gin ("search");--> statement-breakpoint
CREATE INDEX "mail_messages_item_idx" ON "mail_messages" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");