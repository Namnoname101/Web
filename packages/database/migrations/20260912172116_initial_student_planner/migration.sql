-- CreateEnum
CREATE TYPE "event_type_enum" AS ENUM ('CLASS', 'PERSONAL', 'DEADLINE');

-- CreateEnum
CREATE TYPE "event_status_enum" AS ENUM ('SCHEDULED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "event_source_enum" AS ENUM ('MANUAL', 'SCHOOL_PORTAL', 'OUTLOOK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "task_priority_enum" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "task_status_enum" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "task_block_status_enum" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "task_block_origin_enum" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SuggestionKind" AS ENUM ('TASK_PLAN', 'EVENT_CHANGE');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('OUTLOOK', 'UED');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('CONNECTED', 'REAUTH_REQUIRED', 'ERROR', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "password_hash" TEXT,
    "student_id" VARCHAR(64),
    "microsoft_id" VARCHAR(255),
    "locale" VARCHAR(2) NOT NULL DEFAULT 'vi',
    "min_block_minutes" INTEGER NOT NULL DEFAULT 30,
    "travel_minutes" INTEGER NOT NULL DEFAULT 15,
    "study_location" VARCHAR(255),
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "schedule_version" INTEGER NOT NULL DEFAULT 0,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "telegram_chat_id" TEXT,
    "active_start_time" TIME(0) NOT NULL DEFAULT '07:00:00'::time without time zone,
    "active_end_time" TIME(0) NOT NULL DEFAULT '22:00:00'::time without time zone,
    "break_start_time" TIME(0) NOT NULL DEFAULT '11:30:00'::time without time zone,
    "break_end_time" TIME(0) NOT NULL DEFAULT '13:00:00'::time without time zone,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "start_time" TIMESTAMPTZ(6) NOT NULL,
    "end_time" TIMESTAMPTZ(6) NOT NULL,
    "location" VARCHAR(255),
    "event_type" "event_type_enum" NOT NULL,
    "status" "event_status_enum" NOT NULL DEFAULT 'SCHEDULED',
    "source" "event_source_enum" NOT NULL DEFAULT 'MANUAL',
    "external_id" VARCHAR(512),
    "source_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "location" VARCHAR(255),
    "duration_minutes" INTEGER NOT NULL,
    "deadline" TIMESTAMPTZ(6) NOT NULL,
    "priority" "task_priority_enum" NOT NULL DEFAULT 'MEDIUM',
    "status" "task_status_enum" NOT NULL DEFAULT 'PENDING',
    "is_splittable" BOOLEAN NOT NULL DEFAULT true,
    "is_scheduled" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_schedule_blocks" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "start_time" TIMESTAMPTZ(6) NOT NULL,
    "end_time" TIMESTAMPTZ(6) NOT NULL,
    "status" "task_block_status_enum" NOT NULL DEFAULT 'SCHEDULED',
    "origin" "task_block_origin_enum" NOT NULL DEFAULT 'AUTO',
    "location" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "task_schedule_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_attempts" (
    "state_hash" VARCHAR(64) NOT NULL,
    "browser_hash" VARCHAR(64) NOT NULL,
    "encrypted_secret" TEXT NOT NULL,
    "user_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "oauth_attempts_pkey" PRIMARY KEY ("state_hash")
);

-- CreateTable
CREATE TABLE "suggestions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "SuggestionKind" NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "title_vi" VARCHAR(255) NOT NULL,
    "title_en" VARCHAR(255) NOT NULL,
    "payload" JSONB NOT NULL,
    "base_version" INTEGER NOT NULL,
    "source_key" VARCHAR(512),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title_vi" VARCHAR(255) NOT NULL,
    "title_en" VARCHAR(255) NOT NULL,
    "body_vi" TEXT NOT NULL,
    "body_en" TEXT NOT NULL,
    "dedupe_key" VARCHAR(512),
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "encrypted_secret" TEXT,
    "cursor" JSONB NOT NULL DEFAULT '{}',
    "last_sync_at" TIMESTAMPTZ(6),
    "next_sync_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(6),
    "failures" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "external_id" VARCHAR(512) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "data" JSONB NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_student_id_key" ON "users"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_microsoft_id_key" ON "users"("microsoft_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_chat_id_key" ON "users"("telegram_chat_id");

-- CreateIndex
CREATE INDEX "ix_events_user_time" ON "events"("user_id", "start_time", "end_time");

-- CreateIndex
CREATE INDEX "ix_events_user_status_start" ON "events"("user_id", "status", "start_time");

-- CreateIndex
CREATE UNIQUE INDEX "uq_events_external_source" ON "events"("user_id", "source", "external_id");

-- CreateIndex
CREATE INDEX "ix_tasks_scheduling_queue" ON "tasks"("user_id", "priority", "deadline");

-- CreateIndex
CREATE INDEX "ix_tasks_user_deadline" ON "tasks"("user_id", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tasks_id_user" ON "tasks"("id", "user_id");

-- CreateIndex
CREATE INDEX "ix_task_schedule_blocks_user_time" ON "task_schedule_blocks"("user_id", "start_time", "end_time");

-- CreateIndex
CREATE INDEX "ix_task_schedule_blocks_task_status" ON "task_schedule_blocks"("task_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_task_schedule_blocks_exact_slot" ON "task_schedule_blocks"("task_id", "start_time", "end_time");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "oauth_attempts_expires_at_idx" ON "oauth_attempts"("expires_at");

-- CreateIndex
CREATE INDEX "suggestions_user_id_status_created_at_idx" ON "suggestions"("user_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "suggestions_user_id_source_key_key" ON "suggestions"("user_id", "source_key");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "integrations_status_next_sync_at_idx" ON "integrations"("status", "next_sync_at");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_user_id_provider_key" ON "integrations"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "academic_records_user_id_category_external_id_key" ON "academic_records"("user_id", "category", "external_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedule_blocks" ADD CONSTRAINT "task_schedule_blocks_task_id_user_id_fkey" FOREIGN KEY ("task_id", "user_id") REFERENCES "tasks"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_records" ADD CONSTRAINT "academic_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
