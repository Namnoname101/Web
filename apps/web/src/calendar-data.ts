import { formatInTimeZone } from 'date-fns-tz';
import { agendaItems } from './agenda';
import { groupTodayByDaypart } from './dashboard-data';
import { dayStart, shiftDay } from './lib';
import type { AgendaItem, Bootstrap, CalendarEvent } from './types';

export interface CalendarItem extends AgendaItem {
  calendarKind: 'ued' | 'study' | 'personal' | 'deadline' | 'legacy';
}

/** Legacy class/deadline events have no task relation and must never enter the personal editor. */
export const isPersonalEvent = (event: CalendarEvent) => event.source === 'MANUAL' && event.eventType === 'PERSONAL';

export function buildCalendarItems(data: Pick<Bootstrap, 'events' | 'blocks' | 'tasks'>): CalendarItem[] {
  const scheduled: CalendarItem[] = agendaItems(data.events, data.blocks, data.tasks).map(item => ({
    ...item,
    calendarKind: item.block ? 'study' : item.event?.source === 'SCHOOL_PORTAL' ? 'ued'
      : item.event && isPersonalEvent(item.event) ? 'personal' : 'legacy',
  }));
  // Weekly blocks may reference older tasks outside the loaded history page.
  // Canonical task data wins over a nested snapshot; never guess identity by title.
  const tasks = new Map(data.blocks.flatMap(block => block.task ? [[block.task.id, block.task] as const] : []));
  data.tasks.forEach(task => tasks.set(task.id, task));
  const deadlines: CalendarItem[] = [...tasks.values()].filter(task => task.status !== 'CANCELLED').map(task => ({
    id: `deadline:${task.id}`, title: task.title, startTime: task.deadline, endTime: task.deadline,
    location: task.location, kind: 'DEADLINE', calendarKind: 'deadline', task,
  }));
  return [...scheduled, ...deadlines].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || a.id.localeCompare(b.id));
}

export function calendarItemsForDay(items: CalendarItem[], day: string, timezone: string) {
  const start = Date.parse(dayStart(day, timezone)), end = Date.parse(dayStart(shiftDay(day, 1), timezone));
  return items.filter(item => item.calendarKind === 'deadline'
    ? Date.parse(item.startTime) >= start && Date.parse(item.startTime) < end
    : Date.parse(item.startTime) < end && Date.parse(item.endTime) > start);
}

/** Visual grouping does not change timestamps or reserve time for deadlines. */
export function groupCalendarDay(items: CalendarItem[], day: string, timezone: string) {
  return groupTodayByDaypart(calendarItemsForDay(items, day, timezone), timezone, dayStart(day, timezone));
}

export const GRID_START_HOUR = 6;
export const GRID_END_HOUR = 22;
export const TOTAL_GRID_MINUTES = (GRID_END_HOUR - GRID_START_HOUR) * 60; // 960 minutes
export const CALENDAR_HOURS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR + 1 }, (_, i) => i + GRID_START_HOUR);

export const UED_PERIOD_RANGES: Record<string, string> = {
  '07:00': 'Tiết 1',
  '07:50': 'Tiết 2',
  '08:45': 'Tiết 3',
  '09:40': 'Tiết 4',
  '10:35': 'Tiết 5',
  '11:25': 'Tiết 6',
  '13:00': 'Tiết 7',
  '13:50': 'Tiết 8',
  '14:45': 'Tiết 9',
  '15:40': 'Tiết 10',
  '16:35': 'Tiết 11',
  '17:25': 'Tiết 12',
};

const UED_END_PERIOD_MAP: Record<string, string> = {
  '07:50': '1', '08:40': '2', '09:35': '3', '10:30': '4',
  '11:25': '5', '12:15': '6', '13:50': '7', '14:40': '8',
  '15:35': '9', '16:30': '10', '17:25': '11', '18:15': '12',
};

export function getUedPeriodBadge(startTimeFormatted: string, endTimeFormatted: string): string | null {
  const pStart = UED_PERIOD_RANGES[startTimeFormatted];
  if (!pStart) return null;
  const pEnd = UED_END_PERIOD_MAP[endTimeFormatted];
  const startNum = pStart.replace('Tiết ', '');
  if (pEnd && pEnd !== startNum) {
    return `Tiết ${startNum}–${pEnd}`;
  }
  return pStart;
}

export interface TimedGridItem {
  item: CalendarItem;
  topPercent: number;
  heightPercent: number;
  leftPercent: number;
  widthPercent: number;
  startTimeFormatted: string;
  endTimeFormatted: string;
  periodBadge: string | null;
}

export function partitionCalendarItems(items: CalendarItem[]) {
  const allDayOrDeadlines: CalendarItem[] = [];
  const timedItems: CalendarItem[] = [];
  for (const item of items) {
    if (item.calendarKind === 'deadline') {
      allDayOrDeadlines.push(item);
    } else {
      timedItems.push(item);
    }
  }
  return { allDayOrDeadlines, timedItems };
}

export function layoutTimedItemsForDay(items: CalendarItem[], day: string, timezone: string): TimedGridItem[] {
  const dayStartMs = Date.parse(dayStart(day, timezone));
  const gridStartMs = dayStartMs + GRID_START_HOUR * 3600_000;
  const gridEndMs = dayStartMs + GRID_END_HOUR * 3600_000;

  interface RawTimed {
    item: CalendarItem;
    startMin: number;
    endMin: number;
    startTimeFormatted: string;
    endTimeFormatted: string;
    periodBadge: string | null;
  }

  const rawList: RawTimed[] = [];
  for (const item of items) {
    if (item.calendarKind === 'deadline') continue;
    const startMs = Date.parse(item.startTime);
    const endMs = Date.parse(item.endTime);
    if (endMs <= gridStartMs || startMs >= gridEndMs) continue;

    const clampedStartMs = Math.max(startMs, gridStartMs);
    const clampedEndMs = Math.min(endMs, gridEndMs);

    const startMin = (clampedStartMs - gridStartMs) / 60_000;
    const endMin = Math.max(startMin + 20, (clampedEndMs - gridStartMs) / 60_000);

    const startTimeFormatted = formatInTimeZone(startMs, timezone, 'HH:mm');
    const endTimeFormatted = formatInTimeZone(endMs, timezone, 'HH:mm');
    const periodBadge = item.calendarKind === 'ued' ? getUedPeriodBadge(startTimeFormatted, endTimeFormatted) : null;

    rawList.push({
      item,
      startMin,
      endMin,
      startTimeFormatted,
      endTimeFormatted,
      periodBadge,
    });
  }

  rawList.sort((a, b) => a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin));

  const clusters: RawTimed[][] = [];
  let currentCluster: RawTimed[] = [];
  let clusterEnd = -1;

  for (const item of rawList) {
    if (currentCluster.length === 0 || item.startMin < clusterEnd) {
      currentCluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.endMin);
    } else {
      clusters.push(currentCluster);
      currentCluster = [item];
      clusterEnd = item.endMin;
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  const result: TimedGridItem[] = [];

  for (const cluster of clusters) {
    const colEnds: number[] = [];
    const colAssignments = new Map<CalendarItem, number>();

    for (const item of cluster) {
      let placedCol = -1;
      for (let c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= item.startMin) {
          placedCol = c;
          colEnds[c] = item.endMin;
          break;
        }
      }
      if (placedCol === -1) {
        placedCol = colEnds.length;
        colEnds.push(item.endMin);
      }
      colAssignments.set(item.item, placedCol);
    }

    const totalCols = Math.max(1, colEnds.length);
    for (const raw of cluster) {
      const colIndex = colAssignments.get(raw.item) || 0;
      const topPercent = (raw.startMin / TOTAL_GRID_MINUTES) * 100;
      const heightPercent = Math.max(3.5, ((raw.endMin - raw.startMin) / TOTAL_GRID_MINUTES) * 100);
      const widthPercent = 100 / totalCols;
      const leftPercent = colIndex * widthPercent;

      result.push({
        item: raw.item,
        topPercent,
        heightPercent,
        leftPercent,
        widthPercent,
        startTimeFormatted: raw.startTimeFormatted,
        endTimeFormatted: raw.endTimeFormatted,
        periodBadge: raw.periodBadge,
      });
    }
  }

  return result;
}

export interface MiniCalendarDay {
  dateString: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  hasItems: boolean;
}

export function buildMiniCalendar(
  activeMonthDateString: string,
  selectedDay: string,
  today: string,
  eventDaysSet: Set<string>
): MiniCalendarDay[] {
  const year = Number(activeMonthDateString.slice(0, 4));
  const month = Number(activeMonthDateString.slice(5, 7));

  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const startDayOfWeek = firstDay.getUTCDay();
  const shiftFromMonday = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

  const calendarStart = new Date(Date.UTC(year, month - 1, 1 - shiftFromMonday));

  const days: MiniCalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(calendarStart.getTime() + i * 86_400_000);
    const dateString = d.toISOString().slice(0, 10);
    const dMonth = d.getUTCMonth() + 1;
    days.push({
      dateString,
      dayNumber: d.getUTCDate(),
      isCurrentMonth: dMonth === month,
      isToday: dateString === today,
      isSelected: dateString === selectedDay,
      hasItems: eventDaysSet.has(dateString),
    });
  }
  return days;
}

