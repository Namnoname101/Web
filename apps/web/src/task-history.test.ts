import { describe, expect, it } from 'vitest';
import { appendUniqueTasks, preserveExpandedHistory } from './task-history';
import type { Bootstrap, Task } from './types';

const task = (id: string, status: Task['status']): Task => ({ id, status, title: id, notes: '', location: null,
  deadline: '2026-09-20T15:00:00Z', durationMinutes: 60, priority: 'MEDIUM', isSplittable: true, isScheduled: false });
const snapshot = (tasks: Task[], userId = 'student'): Bootstrap => ({
  user: { id: userId }, tasks, taskHistoryPage: { hasMore: true, nextCursor: 'first' },
  taskStats: { active: 1, completed: 1000, cancelled: 0 },
} as Bootstrap);

describe('expanded task history', () => {
  it('merges repeated rows by id with fresh task state', () => {
    expect(appendUniqueTasks([task('a', 'COMPLETED')], [task('a', 'PENDING'), task('b', 'CANCELLED')]))
      .toEqual([task('a', 'PENDING'), task('b', 'CANCELLED')]);
  });
  it('retains older pages and their cursor while refreshing totals and active rows', () => {
    const old = snapshot([task('older', 'COMPLETED'), task('stale', 'PENDING'), task('reopened', 'COMPLETED')]);
    old.taskHistoryPage = { hasMore: false, nextCursor: null };
    const fresh = snapshot([task('reopened', 'PENDING'), task('recent', 'COMPLETED')]);
    const result = preserveExpandedHistory(old, fresh);
    expect(result.tasks).toEqual([task('older', 'COMPLETED'), task('reopened', 'PENDING'), task('recent', 'COMPLETED')]);
    expect(result.taskHistoryPage).toEqual(old.taskHistoryPage);
    expect(result.taskStats).toEqual(fresh.taskStats);
  });
  it('never preserves another student’s history', () => {
    const fresh = snapshot([], 'another-student');
    expect(preserveExpandedHistory(snapshot([task('private', 'COMPLETED')]), fresh)).toBe(fresh);
    expect(preserveExpandedHistory(null, fresh)).toBe(fresh);
  });
});
