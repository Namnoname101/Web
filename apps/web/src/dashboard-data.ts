import { formatInTimeZone } from 'date-fns-tz';
import { dayStart as localDayStart, shiftDay } from './lib';
import type { AgendaItem, Bootstrap, Task } from './types';

export type DaypartId = 'morning' | 'afternoon' | 'evening' | 'outside';
export interface DaypartGroup<T = AgendaItem> { id: DaypartId; items: T[] }

/** Group by the student's wall clock, not the browser's timezone.
 * An overnight activity belongs to the period in which it overlaps today.
 * Keep an extra group for the hours outside the approved three periods so
 * unusually early/late events never disappear from the daily total.
 */
export function groupTodayByDaypart<T extends Pick<AgendaItem, 'id' | 'startTime' | 'endTime'>>(items: T[], timezone: string, dayStart: string): DaypartGroup<T>[] {
  const groups: DaypartGroup<T>[] = ['morning', 'afternoon', 'evening', 'outside']
    .map(id => ({ id: id as DaypartId, items: [] }));
  const startOfDay = Date.parse(dayStart);
  const ordered = [...items].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || a.id.localeCompare(b.id));
  for (const item of ordered) {
    const startsAt = Date.parse(item.startTime);
    const effectiveStart = startsAt < startOfDay && Date.parse(item.endTime) > startOfDay ? startOfDay : startsAt;
    const [hours, minutes, seconds, milliseconds] = formatInTimeZone(effectiveStart, timezone, 'HH:mm:ss:SSS').split(':').map(Number);
    const time = hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + milliseconds;
    const group = time >= 5 * 3_600_000 && time < 12 * 3_600_000 ? 0
      : time >= 12 * 3_600_000 && time < 18 * 3_600_000 ? 1
      : time >= 18 * 3_600_000 && time <= 23 * 3_600_000 ? 2 : 3;
    groups[group].items.push(item);
  }
  return groups.filter(group => group.id !== 'outside' || group.items.length > 0);
}

/** Derived Dashboard values use only accepted calendar blocks and real tasks.
 * The caller supplies the same server-anchored clock used by the agenda.
 */
export function dashboardMetrics(data: Bootstrap, now: number, week: string, timezone: string) {
  const activeTasks: Task[] = data.tasks
    .filter(task => task.status === 'PENDING' || task.status === 'IN_PROGRESS')
    .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline) || a.id.localeCompare(b.id));
  const nearDeadlineCount = activeTasks.filter(task => {
    const deadline = Date.parse(task.deadline);
    return deadline >= now && deadline <= now + 48 * 3_600_000;
  }).length;
  const overdueCount = activeTasks.filter(task => Date.parse(task.deadline) < now).length;
  const start = Date.parse(localDayStart(week, timezone));
  const end = Date.parse(localDayStart(shiftDay(week, 7), timezone));
  const focusMinutes = data.blocks
    .filter(block => block.status !== 'CANCELLED')
    .reduce((sum, block) => sum + Math.max(0,
      Math.min(Date.parse(block.endTime), end) - Math.max(Date.parse(block.startTime), start),
    ) / 60_000, 0);
  return {
    activeTasks,
    nearDeadlineCount,
    overdueCount,
    focusMinutes,
    scheduledTaskCount: activeTasks.filter(task => task.isScheduled).length,
  };
}
