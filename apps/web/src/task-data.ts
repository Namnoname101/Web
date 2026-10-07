import { minutes, toInput, toInstant } from './lib';
import type { Locale, ScheduleBlock, Task, TaskBlocksResponse } from './types';

export const isActiveTask = (task: Task) => task.status === 'PENDING' || task.status === 'IN_PROGRESS';
export type TaskFilter = 'active' | 'scheduled' | 'COMPLETED' | 'all';

/** Bootstrap includes every active task. Historical tasks are explicitly paginated. */
export function taskMetrics(tasks: Task[], now: number) {
  const active = tasks.filter(isActiveTask);
  return {
    near: active.filter(task => Date.parse(task.deadline) >= now && Date.parse(task.deadline) <= now + 48 * 3_600_000).length,
    overdue: active.filter(task => Date.parse(task.deadline) < now).length,
    scheduled: active.filter(task => task.isScheduled).length,
  };
}

export function filterTasks(tasks: Task[], filter: TaskFilter, search: string, priority: string) {
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const query = search.trim().toLocaleLowerCase();
  return tasks.filter(task => (filter === 'all' || (filter === 'active' ? isActiveTask(task)
    : filter === 'scheduled' ? isActiveTask(task) && task.isScheduled : task.status === 'COMPLETED'))
    && (priority === 'all' || task.priority === priority)
    && `${task.title} ${task.notes}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline) || rank[a.priority] - rank[b.priority] || a.id.localeCompare(b.id));
}

export function blockMinutes(block: ScheduleBlock) {
  return Math.max(0, (Date.parse(block.endTime) - Date.parse(block.startTime)) / 60_000);
}

/** Completion may truncate a session between whole minutes. Round only for
 * display and avoid passing decimal remainders to the integer duration helper.
 */
export function sessionDurationLabel(value: number, locale: Locale) {
  const rounded = Math.round(value * 10) / 10;
  const unit = locale === 'vi' ? 'phút' : 'min';
  if (value > 0 && rounded === 0) return locale === 'vi' ? '<0,1 phút' : '<0.1 min';
  if (Number.isInteger(rounded)) return minutes(rounded, locale);
  return `${new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: 1 }).format(rounded)} ${unit}`;
}

/** Only the task-specific endpoint can establish a complete session total.
 * Never use weekly bootstrap blocks or suggestion payloads as an all-time total.
 * COMPLETED blocks are history, not remaining allocated work after reopening.
 */
export function taskSessionSummary(taskId: string, result: TaskBlocksResponse) {
  const blocks = [...new Map(result.blocks.map(block => [block.id, block])).values()]
    .filter(block => block.taskId === taskId && block.status !== 'CANCELLED');
  const scheduledMinutes = blocks.filter(block => block.status === 'SCHEDULED').reduce((sum, block) => sum + blockMinutes(block), 0);
  const completedMinutes = blocks.filter(block => block.status === 'COMPLETED').reduce((sum, block) => sum + blockMinutes(block), 0);
  return { blocks, scheduledMinutes, completedMinutes, complete: !result.page.hasMore };
}

/** Preserve untouched timestamp precision (and DST offset) in a minute-resolution editor. */
export function taskDeadlineInput(wallTime: string, timezone: string, existing?: Task) {
  return existing && wallTime === toInput(existing.deadline, timezone) ? existing.deadline : toInstant(wallTime, timezone);
}
