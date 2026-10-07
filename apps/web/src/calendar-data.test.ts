import { describe, expect, it } from 'vitest';
import { buildCalendarItems, buildMiniCalendar, calendarItemsForDay, getUedPeriodBadge, groupCalendarDay, isPersonalEvent, layoutTimedItemsForDay, partitionCalendarItems } from './calendar-data';
import type { CalendarEvent, ScheduleBlock, Task } from './types';

const timezone = 'Asia/Ho_Chi_Minh';
const task: Task = { id: 'task', title: 'Deadline task', notes: '', location: null, durationMinutes: 60, priority: 'HIGH', status: 'PENDING', isScheduled: false, isSplittable: true, deadline: '2026-09-14T17:00:00Z' };
const event: CalendarEvent = { id: 'event', title: 'Activity', startTime: '2026-09-14T01:00:00Z', endTime: '2026-09-14T02:00:00Z', location: null, source: 'MANUAL', eventType: 'PERSONAL', status: 'SCHEDULED' };
const block: ScheduleBlock = { id: 'session', taskId: 'task', startTime: '2026-09-14T11:00:00Z', endTime: '2026-09-14T12:00:00Z', location: null, status: 'SCHEDULED', task };

describe('Calendar source mapping', () => {
  it('keeps UED, personal events, accepted sessions, task deadlines and legacy markers distinct', () => {
    const items = buildCalendarItems({ events: [event, { ...event, id: 'ued', source: 'SCHOOL_PORTAL', eventType: 'CLASS' }, { ...event, id: 'old', eventType: 'DEADLINE' }], tasks: [task], blocks: [block] });
    expect(items.map(item => item.calendarKind).sort()).toEqual(['deadline', 'legacy', 'personal', 'study', 'ued']);
    const deadline = items.find(item => item.calendarKind === 'deadline')!;
    expect(deadline.event).toBeUndefined();
    expect(deadline.task).toBe(task);
    expect(deadline.startTime).toBe(deadline.endTime);
    expect(isPersonalEvent(event)).toBe(true);
    expect(isPersonalEvent({ ...event, source: 'SCHOOL_PORTAL' })).toBe(false);
    expect(isPersonalEvent({ ...event, eventType: 'DEADLINE' })).toBe(false);
  });
  it('deduplicates task relations and prefers the current task over the nested snapshot', () => {
    const current = { ...task, deadline: '2026-09-15T15:00:00Z' };
    const items = buildCalendarItems({ events: [], tasks: [current], blocks: [block, { ...block, id: 'session2' }] });
    expect(items.filter(item => item.calendarKind === 'deadline')).toHaveLength(1);
    expect(items.find(item => item.calendarKind === 'deadline')?.startTime).toBe(current.deadline);
    expect(buildCalendarItems({ events: [], tasks: [], blocks: [block] }).some(item => item.calendarKind === 'deadline')).toBe(true);
  });
  it('excludes cancelled activities and deadlines but retains completed history', () => {
    const items = buildCalendarItems({ events: [{ ...event, status: 'CANCELLED' }], blocks: [{ ...block, status: 'CANCELLED' }], tasks: [{ ...task, status: 'CANCELLED' }] });
    expect(items).toEqual([]);
    expect(buildCalendarItems({ events: [], blocks: [], tasks: [{ ...task, status: 'COMPLETED' }] })).toHaveLength(1);
  });
  it('uses only persisted blocks, never proposal blocks', () => {
    const data = { events: [], blocks: [], tasks: [task], suggestions: [{ payload: { blocks: [block] } }] };
    expect(buildCalendarItems(data).filter(item => item.calendarKind === 'study')).toEqual([]);
  });
});

describe('Calendar local day and periods', () => {
  it('puts a midnight deadline only on its own local date', () => {
    const items = buildCalendarItems({ events: [], tasks: [task], blocks: [] });
    expect(calendarItemsForDay(items, '2026-09-14', timezone)).toHaveLength(0);
    expect(calendarItemsForDay(items, '2026-09-15', timezone)).toHaveLength(1);
    expect(groupCalendarDay(items, '2026-09-15', timezone).find(group => group.id === 'outside')?.items).toHaveLength(1);
  });
  it('shows overnight events on both overlap dates without changing timestamps', () => {
    const overnight = { ...event, startTime: '2026-09-14T16:30:00Z', endTime: '2026-09-14T18:00:00Z' };
    const items = buildCalendarItems({ events: [overnight], tasks: [], blocks: [] });
    expect(calendarItemsForDay(items, '2026-09-14', timezone)).toHaveLength(1);
    expect(calendarItemsForDay(items, '2026-09-15', timezone)).toHaveLength(1);
    expect(groupCalendarDay(items, '2026-09-15', timezone).find(group => group.id === 'outside')?.items[0].startTime).toBe(overnight.startTime);
    expect(calendarItemsForDay(items, '2026-09-16', timezone)).toHaveLength(0);
  });
  it('does not lose outside-hour events or duplicate an item within a day', () => {
    const starts = ['2026-09-13T21:00:00Z', '2026-09-13T22:00:00Z', '2026-09-14T05:00:00Z', '2026-09-14T11:00:00Z', '2026-09-14T16:00:00Z', '2026-09-14T16:30:00Z'];
    const events = starts.map((startTime, i) => ({ ...event, id: String(i), startTime, endTime: new Date(Date.parse(startTime) + 60_000).toISOString() }));
    const groups = groupCalendarDay(buildCalendarItems({ events, blocks: [], tasks: [] }), '2026-09-14', timezone);
    expect(groups.map(group => [group.id, group.items.length])).toEqual([['morning', 1], ['afternoon', 1], ['evening', 2], ['outside', 2]]);
    expect(new Set(groups.flatMap(group => group.items.map(item => item.id))).size).toBe(6);
    expect(events.map(item => item.startTime)).toEqual(starts);
  });
  it('respects DST day boundaries and excludes intervals that merely touch midnight', () => {
    const events = [{ ...event, startTime: '2026-03-09T03:30:00Z', endTime: '2026-03-09T04:00:00Z' }, { ...event, id: 'next', startTime: '2026-03-09T04:00:00Z', endTime: '2026-03-09T05:00:00Z' }];
    const items = buildCalendarItems({ events, tasks: [], blocks: [] });
    expect(calendarItemsForDay(items, '2026-03-08', 'America/New_York').map(item => item.id)).toEqual(['event:event']);
    expect(calendarItemsForDay(items, '2026-03-09', 'America/New_York').map(item => item.id)).toEqual(['event:next']);
  });
});

describe('Calendar time grid layout & period badges', () => {
  it('identifies UED period ranges from start and end times', () => {
    expect(getUedPeriodBadge('07:00', '08:40')).toBe('Tiết 1–2');
    expect(getUedPeriodBadge('13:00', '15:35')).toBe('Tiết 7–9');
    expect(getUedPeriodBadge('07:00', '07:50')).toBe('Tiết 1');
    expect(getUedPeriodBadge('10:00', '11:00')).toBeNull();
  });

  it('partitions deadlines and timed items accurately', () => {
    const items = buildCalendarItems({ events: [event], tasks: [task], blocks: [block] });
    const { allDayOrDeadlines, timedItems } = partitionCalendarItems(items);
    expect(allDayOrDeadlines).toHaveLength(1);
    expect(allDayOrDeadlines[0].calendarKind).toBe('deadline');
    expect(timedItems).toHaveLength(2);
  });

  it('calculates proportional top and height percentages for timed items', () => {
    // 07:00 to 08:40 UTC+7 is 00:00 to 01:40 UTC
    const morningClass: CalendarEvent = {
      id: 'class1', title: 'Web Dev', startTime: '2026-09-14T00:00:00Z', endTime: '2026-09-14T01:40:00Z',
      location: 'B3-303', source: 'SCHOOL_PORTAL', eventType: 'CLASS', status: 'SCHEDULED'
    };
    const items = buildCalendarItems({ events: [morningClass], tasks: [], blocks: [] });
    const layout = layoutTimedItemsForDay(items, '2026-09-14', timezone);
    expect(layout).toHaveLength(1);
    expect(layout[0].startTimeFormatted).toBe('07:00');
    expect(layout[0].endTimeFormatted).toBe('08:40');
    expect(layout[0].periodBadge).toBe('Tiết 1–2');
    // 07:00 is 60 mins from 06:00 -> 60 / 960 * 100 = 6.25%
    expect(layout[0].topPercent).toBeCloseTo(6.25, 1);
    // 100 mins duration -> 100 / 960 * 100 = 10.416%
    expect(layout[0].heightPercent).toBeCloseTo(10.42, 1);
  });

  it('allocates side-by-side columns when timed items overlap', () => {
    const ev1: CalendarEvent = { id: 'e1', title: 'Meeting 1', startTime: '2026-09-14T01:00:00Z', endTime: '2026-09-14T03:00:00Z', location: null, source: 'MANUAL', eventType: 'PERSONAL', status: 'SCHEDULED' };
    const ev2: CalendarEvent = { id: 'e2', title: 'Meeting 2', startTime: '2026-09-14T02:00:00Z', endTime: '2026-09-14T04:00:00Z', location: null, source: 'MANUAL', eventType: 'PERSONAL', status: 'SCHEDULED' };
    const items = buildCalendarItems({ events: [ev1, ev2], tasks: [], blocks: [] });
    const layout = layoutTimedItemsForDay(items, '2026-09-14', timezone);
    expect(layout).toHaveLength(2);
    expect(layout[0].widthPercent).toBe(50);
    expect(layout[1].widthPercent).toBe(50);
    expect(layout[0].leftPercent).toBe(0);
    expect(layout[1].leftPercent).toBe(50);
  });
});

describe('Mini-calendar month generation', () => {
  it('generates 42 days grid starting on Monday for the active month', () => {
    const miniDays = buildMiniCalendar('2026-10-01', '2026-10-08', '2026-10-08', new Set(['2026-10-08', '2026-10-09']));
    expect(miniDays).toHaveLength(42);
    // First day should be a Monday
    const firstDate = new Date(`${miniDays[0].dateString}T12:00:00Z`);
    expect(firstDate.getUTCDay()).toBe(1); // Monday

    const selected = miniDays.find(d => d.isSelected);
    expect(selected?.dateString).toBe('2026-10-08');
    expect(selected?.isToday).toBe(true);
    expect(selected?.hasItems).toBe(true);
  });
});

