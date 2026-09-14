ALTER TABLE users ADD CONSTRAINT users_daily_hours CHECK (
  active_start_time < active_end_time AND break_start_time >= active_start_time
  AND break_start_time < break_end_time AND break_end_time <= active_end_time
);
ALTER TABLE users ADD CONSTRAINT users_minimum_block CHECK (min_block_minutes BETWEEN 15 AND 120);
ALTER TABLE users ADD CONSTRAINT users_travel CHECK (travel_minutes BETWEEN 0 AND 120);
ALTER TABLE users ADD CONSTRAINT users_locale CHECK (locale IN ('vi', 'en'));
ALTER TABLE events ADD CONSTRAINT events_positive_interval CHECK (end_time > start_time);
ALTER TABLE tasks ADD CONSTRAINT tasks_positive_duration CHECK (duration_minutes BETWEEN 15 AND 43200);
ALTER TABLE task_schedule_blocks ADD CONSTRAINT blocks_positive_interval CHECK (end_time > start_time);
