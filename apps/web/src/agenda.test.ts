import { describe, expect, it } from 'vitest';
import { agendaItems, buildAgendaView, temporalState } from './agenda';
import type { AgendaOverview, CalendarEvent, ScheduleBlock, Task } from './types';

const event = (id: string, startTime: string, endTime: string, status: CalendarEvent['status'] = 'SCHEDULED'): CalendarEvent => ({
  id, title: id, startTime, endTime, status, eventType: 'CLASS', source: 'MANUAL', location: null,
});
const task: Task = { id: 'task', title: 'Study', notes: '', location: null, durationMinutes: 30, deadline: '2026-09-20T00:00:00.000Z', priority: 'HIGH', status: 'PENDING', isSplittable: true, isScheduled: true };
const block = (id: string, startTime: string, endTime: string, status: ScheduleBlock['status'] = 'SCHEDULED'): ScheduleBlock => ({ id, taskId: task.id, startTime, endTime, status, location: null, task });

function overview(todayEvents: CalendarEvent[] = [], upcomingEvents: CalendarEvent[] = [], pastEvents: CalendarEvent[] = [], blocks: Partial<Record<'today' | 'upcoming' | 'past', ScheduleBlock[]>> = {}): AgendaOverview {
  return {
    asOf: '2026-09-14T05:00:00.000Z', localDate: '2026-09-14', dayStart: '2026-09-13T17:00:00.000Z', dayEnd: '2026-09-14T17:00:00.000Z', limit: 12,
    today: { events: todayEvents, blocks: blocks.today || [] },
    upcoming: { events: upcomingEvents, blocks: blocks.upcoming || [] },
    past: { events: pastEvents, blocks: blocks.past || [] },
  };
}

describe('agenda timeline', () => {
  it('uses half-open boundaries at the exact start and end', () => {
    const item = agendaItems([event('class', '2026-09-14T05:00:00.000Z', '2026-09-14T06:00:00.000Z')], [])[0];
    expect(temporalState(item, Date.parse(item.startTime))).toBe('CURRENT');
    expect(temporalState(item, Date.parse(item.endTime))).toBe('PAST');
  });

  it('filters cancelled events and task blocks', () => {
    const items = agendaItems(
      [event('visible', '2026-09-14T01:00:00.000Z', '2026-09-14T02:00:00.000Z'), event('cancelled', '2026-09-14T02:00:00.000Z', '2026-09-14T03:00:00.000Z', 'CANCELLED')],
      [block('cancelled-block', '2026-09-14T03:00:00.000Z', '2026-09-14T04:00:00.000Z', 'CANCELLED')],
    );
    expect(items.map(item => item.title)).toEqual(['visible']);
  });

  it('shows the true next item beyond today and keeps recent history', () => {
    const old = event('old', '2026-09-13T02:00:00.000Z', '2026-09-13T03:00:00.000Z');
    const later = event('next-week', '2026-09-21T01:00:00.000Z', '2026-09-21T02:00:00.000Z');
    const view = buildAgendaView(overview([], [later], [old]), [task], Date.parse('2026-09-14T05:00:00.000Z'));
    expect(view.next?.title).toBe('next-week');
    expect(view.past.map(item => item.title)).toContain('old');
  });

  it('keeps an overnight item in today and classifies it by its end time', () => {
    const overnight = event('overnight', '2026-09-13T16:00:00.000Z', '2026-09-13T18:00:00.000Z');
    const view = buildAgendaView(overview([overnight]), [task], Date.parse('2026-09-13T17:30:00.000Z'));
    expect(view.current.map(item => item.title)).toEqual(['overnight']);
  });

  it('keeps an item that ended earlier today in both today and past-today', () => {
    const morning = event('morning-class', '2026-09-14T00:00:00.000Z', '2026-09-14T02:35:00.000Z');
    const view = buildAgendaView(overview([morning]), [task], Date.parse('2026-09-14T05:00:00.000Z'));
    expect(view.today.map(item => item.title)).toEqual(['morning-class']);
    expect(view.pastToday.map(item => item.title)).toEqual(['morning-class']);
  });
});
