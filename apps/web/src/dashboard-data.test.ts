import { describe, expect, it } from 'vitest';
import { dashboardMetrics, groupTodayByDaypart } from './dashboard-data';
import type { AgendaItem, Bootstrap, ScheduleBlock, Task } from './types';

const timezone = 'Asia/Ho_Chi_Minh';
const dayStart = '2026-09-13T17:00:00.000Z';
const now = Date.parse('2026-09-14T05:00:00.000Z');
const item = (id: string, startTime: string, endTime = '2026-09-14T16:59:59.999Z'): AgendaItem => ({
  id, title: id, startTime, endTime, location: null, kind: 'PERSONAL',
});
const task = (id: string, deadline: string, extras: Partial<Task> = {}): Task => ({
  id, title: id, deadline, notes: '', location: null, durationMinutes: 60, priority: 'MEDIUM',
  status: 'PENDING', isScheduled: false, isSplittable: true, ...extras,
});
const block = (id: string, startTime: string, endTime: string, status: ScheduleBlock['status'] = 'SCHEDULED'): ScheduleBlock => ({
  id, taskId: 'task', startTime, endTime, status, location: null,
});
// Helpers read these two collections only; no synthetic fixture is shipped to UI.
const data = (tasks: Task[] = [], blocks: ScheduleBlock[] = []) => ({ tasks, blocks } as Bootstrap);

describe('Dashboard dayparts', () => {
  it('uses student timezone and exact approved boundaries without dropping outside hours', () => {
    const items = [
      item('before-five', '2026-09-13T21:59:59.999Z'),
      item('five', '2026-09-13T22:00:00.000Z'),
      item('before-noon', '2026-09-14T04:59:59.999Z'),
      item('noon', '2026-09-14T05:00:00.000Z'),
      item('before-six', '2026-09-14T10:59:59.999Z'),
      item('six', '2026-09-14T11:00:00.000Z'),
      item('eleven', '2026-09-14T16:00:00.000Z'),
      item('after-eleven', '2026-09-14T16:00:00.001Z'),
    ];
    const groups = groupTodayByDaypart(items, timezone, dayStart);
    expect(groups.map(group => [group.id, group.items.map(entry => entry.id)])).toEqual([
      ['morning', ['five', 'before-noon']],
      ['afternoon', ['noon', 'before-six']],
      ['evening', ['six', 'eleven']],
      ['outside', ['before-five', 'after-eleven']],
    ]);
    expect(groups.flatMap(group => group.items)).toHaveLength(items.length);
    expect(new Set(groups.flatMap(group => group.items).map(entry => entry.id)).size).toBe(items.length);
  });

  it('clips overnight activities to today for grouping and retains empty principal periods', () => {
    const overnight = item('overnight', '2026-09-13T15:00:00Z', '2026-09-13T18:00:00Z');
    const groups = groupTodayByDaypart([overnight], timezone, dayStart);
    expect(groups.map(group => [group.id, group.items.length])).toEqual([
      ['morning', 0], ['afternoon', 0], ['evening', 0], ['outside', 1],
    ]);
    expect(groups[3].items[0]).toBe(overnight);
    expect(overnight.startTime).toBe('2026-09-13T15:00:00Z');
    expect(groupTodayByDaypart([], timezone, dayStart).map(group => group.id)).toEqual(['morning', 'afternoon', 'evening']);
  });

  it('sorts each group without changing the incoming collection', () => {
    const later = item('later', '2026-09-14T03:00:00Z');
    const earlier = item('earlier', '2026-09-14T01:00:00Z');
    const input = [later, earlier];
    expect(groupTodayByDaypart(input, timezone, dayStart)[0].items).toEqual([earlier, later]);
    expect(input).toEqual([later, earlier]);
  });
});

describe('Dashboard metrics', () => {
  it('counts exact 48h boundaries, excludes closed tasks, and retains overdue active work', () => {
    const tasks = [
      task('late', '2026-09-14T04:59:59.999Z'),
      task('now', '2026-09-14T05:00:00.000Z'),
      task('limit', '2026-09-16T05:00:00.000Z', { status: 'IN_PROGRESS', isScheduled: true }),
      task('later', '2026-09-16T05:00:00.001Z', { isScheduled: true }),
      task('completed', '2026-09-14T04:00:00Z', { status: 'COMPLETED', isScheduled: true }),
      task('cancelled', '2026-09-15T05:00:00Z', { status: 'CANCELLED' }),
    ];
    const metrics = dashboardMetrics(data(tasks), now, '2026-09-14', timezone);
    expect(metrics.nearDeadlineCount).toBe(2);
    expect(metrics.overdueCount).toBe(1);
    expect(metrics.scheduledTaskCount).toBe(2);
    expect(metrics.activeTasks.map(entry => entry.id)).toEqual(['late', 'now', 'limit', 'later']);
    expect(tasks).toHaveLength(6);
  });

  it('sorts equal deadlines deterministically without mutating bootstrap tasks', () => {
    const tasks = [task('b', '2026-09-15T05:00:00Z'), task('a', '2026-09-15T05:00:00Z')];
    expect(dashboardMetrics(data(tasks), now, '2026-09-14', timezone).activeTasks.map(entry => entry.id)).toEqual(['a', 'b']);
    expect(tasks.map(entry => entry.id)).toEqual(['b', 'a']);
  });

  it('clips accepted study minutes to the local week and excludes cancelled or outside blocks', () => {
    const blocks = [
      block('start-overlap', '2026-09-13T16:30:00Z', '2026-09-13T17:30:00Z'),
      block('completed', '2026-09-15T01:00:00Z', '2026-09-15T02:00:00Z', 'COMPLETED'),
      block('cancelled', '2026-09-15T02:00:00Z', '2026-09-15T03:00:00Z', 'CANCELLED'),
      block('end-overlap', '2026-09-20T16:30:00Z', '2026-09-20T17:30:00Z'),
      block('ends-at-start', '2026-09-13T16:00:00Z', '2026-09-13T17:00:00Z'),
      block('starts-at-end', '2026-09-20T17:00:00Z', '2026-09-20T18:00:00Z'),
    ];
    expect(dashboardMetrics(data([], blocks), now, '2026-09-14', timezone).focusMinutes).toBe(120);
  });

  it('derives DST week boundaries as local dates rather than a fixed 168 hours', () => {
    const blocks = [
      block('spring-next-week', '2026-03-09T04:00:00Z', '2026-03-09T05:00:00Z'),
      block('fall-week-tail', '2026-11-02T04:30:00Z', '2026-11-02T05:30:00Z'),
    ];
    expect(dashboardMetrics(data([], blocks), now, '2026-03-02', 'America/New_York').focusMinutes).toBe(0);
    expect(dashboardMetrics(data([], blocks), now, '2026-10-26', 'America/New_York').focusMinutes).toBe(30);
  });
});
