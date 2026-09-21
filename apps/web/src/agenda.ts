import type { AgendaItem, AgendaOverview, CalendarEvent, ScheduleBlock, Task } from './types';

export type AgendaTemporalState = 'PAST' | 'CURRENT' | 'UPCOMING';

const timestamp = (value: string) => Date.parse(value);
const byStart = (a: AgendaItem, b: AgendaItem) =>
  timestamp(a.startTime) - timestamp(b.startTime)
  || timestamp(a.endTime) - timestamp(b.endTime)
  || a.id.localeCompare(b.id);

export function agendaItems(
  events: CalendarEvent[],
  blocks: ScheduleBlock[],
  tasks: Task[] = [],
  fallbackTaskTitle = 'Study session',
): AgendaItem[] {
  const eventItems: AgendaItem[] = events
    .filter(event => event.status !== 'CANCELLED')
    .map(event => ({
      id: `event:${event.id}`,
      title: event.title,
      startTime: event.startTime,
      endTime: event.endTime,
      location: event.location,
      kind: event.eventType,
      event,
    }));
  const blockItems: AgendaItem[] = blocks
    .filter(block => block.status !== 'CANCELLED')
    .map(block => ({
      id: `task-block:${block.id}`,
      title: block.task?.title || tasks.find(task => task.id === block.taskId)?.title || fallbackTaskTitle,
      startTime: block.startTime,
      endTime: block.endTime,
      location: block.location,
      kind: 'TASK',
      task: block.task || tasks.find(task => task.id === block.taskId),
      block,
    }));

  return [...eventItems, ...blockItems].sort(byStart);
}

export function temporalState(item: Pick<AgendaItem, 'startTime' | 'endTime'>, now: number): AgendaTemporalState {
  if (timestamp(item.endTime) <= now) return 'PAST';
  if (timestamp(item.startTime) <= now) return 'CURRENT';
  return 'UPCOMING';
}

function unique(items: AgendaItem[]) {
  return [...new Map(items.map(item => [item.id, item])).values()];
}

export function buildAgendaView(
  overview: AgendaOverview,
  tasks: Task[],
  now: number,
  fallbackTaskTitle = 'Study session',
) {
  const from = (collection: AgendaOverview['today']) => agendaItems(collection.events, collection.blocks, tasks, fallbackTaskTitle);
  const today = from(overview.today);
  const current = today.filter(item => temporalState(item, now) === 'CURRENT');
  const pastToday = today.filter(item => temporalState(item, now) === 'PAST');
  const upcomingToday = today.filter(item => temporalState(item, now) === 'UPCOMING');
  const upcoming = unique([...today, ...from(overview.upcoming)])
    .filter(item => timestamp(item.startTime) > now)
    .sort(byStart)
    .slice(0, overview.limit);
  const past = unique([...today, ...from(overview.past)])
    .filter(item => timestamp(item.endTime) <= now)
    .sort((a, b) => timestamp(b.endTime) - timestamp(a.endTime) || byStart(b, a))
    .slice(0, overview.limit);

  return { today, current, pastToday, upcomingToday, upcoming, past, next: upcoming[0] || null };
}
