import { describe, expect, it } from 'vitest';
import { blockMinutes, filterTasks, isActiveTask, sessionDurationLabel, taskDeadlineInput, taskMetrics, taskSessionSummary } from './task-data';
import type { ScheduleBlock, Task, TaskBlocksResponse } from './types';

const now = Date.parse('2026-09-14T05:00:00Z');
const task: Task = { id: 'task', title: 'Báo cáo', notes: 'SQL', location: null, durationMinutes: 120, deadline: '2026-09-15T15:00:00Z', priority: 'HIGH', status: 'PENDING', isScheduled: false, isSplittable: true };
const block: ScheduleBlock = { id: 'a', taskId: 'task', startTime: '2026-09-14T07:00:00Z', endTime: '2026-09-14T08:00:00Z', status: 'SCHEDULED', location: null };
const result = (blocks: ScheduleBlock[], hasMore = false): TaskBlocksResponse => ({ blocks, hasFutureBlocks: true, page: { hasMore, nextCursor: hasMore ? 'next' : null } });

describe('Task list and metrics', () => {
  it('includes pending and in-progress work but not finished/cancelled tasks', () => {
    expect(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map(status => isActiveTask({ ...task, status: status as Task['status'] }))).toEqual([true, true, false, false]);
  });
  it('sorts deadline first, priority on ties, retaining overdue work', () => {
    const rows = [task, { ...task, id: 'late', deadline: '2026-09-16T15:00:00Z' }, { ...task, id: 'overdue', priority: 'LOW' as const, deadline: '2026-09-13T15:00:00Z' }, { ...task, id: 'medium', priority: 'MEDIUM' as const }];
    expect(filterTasks(rows, 'active', '', 'all').map(row => row.id)).toEqual(['overdue', 'task', 'medium', 'late']);
    expect(rows[0]).toBe(task);
  });
  it('counts only active deadlines in the next 48 hours, inclusive', () => {
    const at = (delta: number, id: string) => ({ ...task, id, deadline: new Date(now + delta).toISOString() });
    expect(taskMetrics([at(-1, 'past'), at(0, 'now'), at(48 * 3600000, 'edge'), at(48 * 3600000 + 1, 'later'), { ...at(1, 'done'), status: 'COMPLETED' }], now)).toEqual({ near: 2, overdue: 1, scheduled: 0 });
  });
  it('preserves title/notes search, priority and completed filters', () => {
    const done = { ...task, id: 'done', status: 'COMPLETED' as const };
    expect(filterTasks([task, done], 'COMPLETED', ' sql ', 'HIGH')).toEqual([done]);
    expect(filterTasks([task], 'active', 'missing', 'all')).toEqual([]);
  });
  it('uses the server scheduling flag rather than proposal payloads or names', () => {
    const proposed = { ...task, suggestions: [{ blocks: [block] }] };
    expect(filterTasks([proposed], 'scheduled', '', 'all')).toEqual([]);
    expect(filterTasks([{ ...task, isScheduled: true }], 'scheduled', '', 'all')).toHaveLength(1);
  });
});

describe('Accepted task session accounting', () => {
  it('formats a truncated session without floating-point remainder artifacts', () => {
    const elapsed = blockMinutes({ ...block, endTime: '2026-09-14T08:30:06.123Z', status: 'COMPLETED' });
    expect(elapsed).toBeCloseTo(90.10205);
    expect(sessionDurationLabel(elapsed, 'vi')).toBe('90,1 phút');
    expect(sessionDurationLabel(elapsed, 'en')).toBe('90.1 min');
  });
  it('keeps whole-hour labels and does not show a positive short session as zero', () => {
    expect(sessionDurationLabel(120, 'vi')).toBe('2g');
    expect(sessionDurationLabel(59.999, 'en')).toBe('1h');
    expect(sessionDurationLabel(1 / 60, 'vi')).toBe('<0,1 phút');
    expect(sessionDurationLabel(1 / 60, 'en')).toBe('<0.1 min');
  });
  it('deduplicates IDs and excludes cancelled/foreign blocks', () => {
    const summary = taskSessionSummary('task', result([block, block, { ...block, id: 'cancel', status: 'CANCELLED' }, { ...block, id: 'foreign', taskId: 'other' }]));
    expect(summary.blocks).toHaveLength(1); expect(summary.scheduledMinutes).toBe(60); expect(summary.complete).toBe(true);
  });
  it('does not present a page as a complete total', () => {
    expect(taskSessionSummary('task', result([block], true)).complete).toBe(false);
  });
  it('keeps completed history separate from reopened task scheduling', () => {
    const summary = taskSessionSummary('task', result([block, { ...block, id: 'history', status: 'COMPLETED' }]));
    expect(summary.scheduledMinutes).toBe(60); expect(summary.completedMinutes).toBe(60);
  });
  it('uses actual elapsed time for overnight/DST sessions', () => {
    const summary = taskSessionSummary('task', result([{ ...block, startTime: '2026-11-01T01:30:00-04:00', endTime: '2026-11-01T01:30:00-05:00' }]));
    expect(summary.scheduledMinutes).toBe(60);
  });
});

describe('Editing deadlines', () => {
  it('preserves seconds and milliseconds when the minute field is untouched', () => {
    const existing = { ...task, deadline: '2026-09-15T15:00:45.123Z' };
    expect(taskDeadlineInput('2026-09-15T22:00', 'Asia/Ho_Chi_Minh', existing)).toBe(existing.deadline);
  });
  it('converts an edited time from account timezone rather than device timezone', () => {
    expect(taskDeadlineInput('2026-09-15T21:30', 'Asia/Ho_Chi_Minh', task)).toBe('2026-09-15T14:30:00.000Z');
  });
  it('rejects nonexistent local times instead of silently shifting them', () => {
    expect(() => taskDeadlineInput('2026-03-08T02:30', 'America/New_York')).toThrow();
  });
});
