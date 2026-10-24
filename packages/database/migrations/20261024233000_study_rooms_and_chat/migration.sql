-- CreateEnum
CREATE TYPE "room_pomodoro_state_enum" AS ENUM ('IDLE', 'FOCUS', 'BREAK');

-- CreateEnum
CREATE TYPE "invite_status_enum" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "study_rooms" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(255),
    "passcode" VARCHAR(32),
    "max_participants" INTEGER NOT NULL DEFAULT 6,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "host_id" UUID NOT NULL,
    "pomodoro_state" "room_pomodoro_state_enum" NOT NULL DEFAULT 'IDLE',
    "focus_minutes" INTEGER NOT NULL DEFAULT 25,
    "break_minutes" INTEGER NOT NULL DEFAULT 5,
    "timer_ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "study_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_room_participants" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "current_task" VARCHAR(120),
    "is_cam_on" BOOLEAN NOT NULL DEFAULT false,
    "is_mic_on" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_room_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_room_invites" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "target_student_id" VARCHAR(64) NOT NULL,
    "status" "invite_status_enum" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_room_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_chat_messages" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "content" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_conversations" (
    "id" UUID NOT NULL,
    "user1_id" UUID NOT NULL,
    "user2_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "direct_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_chat_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "content" VARCHAR(2000) NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "study_room_participants_room_id_user_id_key" ON "study_room_participants"("room_id", "user_id");

-- CreateIndex
CREATE INDEX "study_room_invites_target_student_id_status_idx" ON "study_room_invites"("target_student_id", "status");

-- CreateIndex
CREATE INDEX "room_chat_messages_room_id_created_at_idx" ON "room_chat_messages"("room_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "direct_conversations_user1_id_user2_id_key" ON "direct_conversations"("user1_id", "user2_id");

-- CreateIndex
CREATE INDEX "direct_chat_messages_conversation_id_created_at_idx" ON "direct_chat_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "study_rooms" ADD CONSTRAINT "study_rooms_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_room_participants" ADD CONSTRAINT "study_room_participants_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "study_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_room_participants" ADD CONSTRAINT "study_room_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_room_invites" ADD CONSTRAINT "study_room_invites_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "study_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_room_invites" ADD CONSTRAINT "study_room_invites_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_chat_messages" ADD CONSTRAINT "room_chat_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "study_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_chat_messages" ADD CONSTRAINT "room_chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_user1_id_fkey" FOREIGN KEY ("user1_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_user2_id_fkey" FOREIGN KEY ("user2_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_chat_messages" ADD CONSTRAINT "direct_chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "direct_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_chat_messages" ADD CONSTRAINT "direct_chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
