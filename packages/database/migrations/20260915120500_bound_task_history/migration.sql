CREATE INDEX "ix_tasks_user_status_history"
  ON "tasks" ("user_id", "status", "updated_at", "id");

CREATE INDEX "ix_task_schedule_blocks_user_task_history"
  ON "task_schedule_blocks" ("user_id", "task_id", "start_time", "id");
