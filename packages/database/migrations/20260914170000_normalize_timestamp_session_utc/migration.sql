-- The initial application could inherit a non-UTC PostgreSQL session timezone.
-- @prisma/adapter-pg serializes JavaScript Date parameters as wall-clock values,
-- so those application-written instants were interpreted in that inherited
-- timezone and stored with an offset. Convert only application-supplied instant
-- columns from the old session wall clock to their intended UTC wall clock.
-- Database-default created_at values are already real instants and are left as-is.
DO $$
DECLARE
  source_timezone text := current_setting('TimeZone');
BEGIN
  IF upper(source_timezone) IN ('UTC', 'ETC/UTC', 'GMT') THEN
    RETURN;
  END IF;

  UPDATE "users"
    SET "updated_at" = ("updated_at" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC';

  UPDATE "events"
    SET "start_time" = ("start_time" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC',
        "end_time" = ("end_time" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC',
        "updated_at" = ("updated_at" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC';

  UPDATE "tasks"
    SET "deadline" = ("deadline" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC',
        "completed_at" = CASE WHEN "completed_at" IS NULL THEN NULL
          ELSE ("completed_at" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC' END,
        "updated_at" = ("updated_at" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC';

  UPDATE "task_schedule_blocks"
    SET "start_time" = ("start_time" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC',
        "end_time" = ("end_time" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC',
        "updated_at" = ("updated_at" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC';

  UPDATE "sessions"
    SET "expires_at" = ("expires_at" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC';

  UPDATE "oauth_attempts"
    SET "expires_at" = ("expires_at" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC';

  UPDATE "suggestions"
    SET "expires_at" = ("expires_at" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC',
        "decided_at" = CASE WHEN "decided_at" IS NULL THEN NULL
          ELSE ("decided_at" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC' END;

  UPDATE "notifications"
    SET "read_at" = CASE WHEN "read_at" IS NULL THEN NULL
      ELSE ("read_at" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC' END;

  UPDATE "integrations"
    SET "last_sync_at" = CASE WHEN "last_sync_at" IS NULL THEN NULL
          ELSE ("last_sync_at" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC' END,
        "next_sync_at" = ("next_sync_at" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC',
        "locked_until" = CASE WHEN "locked_until" IS NULL THEN NULL
          ELSE ("locked_until" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC' END,
        "updated_at" = ("updated_at" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC';

  -- Queue connected sources promptly even when next_sync_at originally came
  -- from a database default rather than an application Date parameter.
  UPDATE "integrations" SET "next_sync_at" = LEAST("next_sync_at", CURRENT_TIMESTAMP);

  UPDATE "academic_records"
    SET "synced_at" = ("synced_at" AT TIME ZONE source_timezone) AT TIME ZONE 'UTC';
END $$;
