import { addMinutes } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export interface Interval { startTime: Date; endTime: Date; location?: string | null }
export interface PlanningTask {
  id: string; title: string; durationMinutes: number; deadline: Date;
  priority: 'HIGH' | 'MEDIUM' | 'LOW'; isSplittable: boolean;
  createdAt: Date; location?: string | null;
}
export interface PlanningSettings {
  activeStartTime: Date | string; activeEndTime: Date | string;
  breakStartTime: Date | string; breakEndTime: Date | string;
  timezone: string; minBlockMinutes: number; travelMinutes: number;
  studyLocation?: string | null;
}
export interface PlanBlock extends Interval { taskId: string; taskTitle: string }
export interface UnscheduledTask { taskId: string; title: string; reason: 'DEADLINE_PASSED' | 'BELOW_MINIMUM' | 'INSUFFICIENT_TIME' | 'PARTIAL_UNSPLITTABLE' }
export interface Plan { blocks: PlanBlock[]; unscheduled: UnscheduledTask[] }
const MINUTE = 60_000;
const DAY = 86_400_000;
const priority = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function clock(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(11, 16) : value.slice(0, 5);
}

export function validateSettings(settings: PlanningSettings): void {
  const times = [settings.activeStartTime, settings.activeEndTime, settings.breakStartTime, settings.breakEndTime].map(clock);
  if (times.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw new Error('INVALID_TIME');
  const [start, end, restStart, restEnd] = times;
  if (!(start < end && restStart >= start && restEnd <= end && restStart < restEnd)) throw new Error('INVALID_HOURS');
  if (!Number.isInteger(settings.minBlockMinutes) || settings.minBlockMinutes < 15 || settings.minBlockMinutes > 120) throw new Error('INVALID_MINIMUM');
  if (!Number.isInteger(settings.travelMinutes) || settings.travelMinutes < 0 || settings.travelMinutes > 120) throw new Error('INVALID_BUFFER');
  new Intl.DateTimeFormat('en', { timeZone: settings.timezone }).format();
}

/** Build wall-clock windows one local calendar day at a time, independent of server TZ. */
export function allowedWindows(settings: PlanningSettings, from: Date, to: Date): Interval[] {
  validateSettings(settings);
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || +to <= +from || +to - +from > 366 * DAY) throw new Error('INVALID_RANGE');
  let key = formatInTimeZone(from, settings.timezone, 'yyyy-MM-dd');
  const last = formatInTimeZone(new Date(+to - 1), settings.timezone, 'yyyy-MM-dd');
  const result: Interval[] = [];
  while (key <= last) {
    const local = (value: Date | string) => {
      const text = `${key}T${clock(value)}:00`;
      const instant = fromZonedTime(text, settings.timezone);
      if (formatInTimeZone(instant, settings.timezone, "yyyy-MM-dd'T'HH:mm:ss") !== text) throw new Error('NONEXISTENT_LOCAL_TIME');
      return instant;
    };
    for (const [s, e] of [[settings.activeStartTime, settings.breakStartTime], [settings.breakEndTime, settings.activeEndTime]]) {
      // Round inward so a block never begins before the requested instant.
      const startTime = new Date(Math.ceil(Math.max(+from, +local(s)) / MINUTE) * MINUTE);
      const endTime = new Date(Math.min(+to, +local(e)));
      if (+endTime > +startTime) result.push({ startTime, endTime });
    }
    key = new Date(Date.parse(`${key}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
  }
  return result;
}

const normalized = (location?: string | null) => location?.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ') || null;
export function bufferBetween(a: Interval, b: Interval, travelMinutes: number): number {
  const location = normalized(a.location);
  return location && location === normalized(b.location) ? 0 : travelMinutes;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return +a.startTime < +b.endTime && +b.startTime < +a.endTime;
}

export function conflicts(a: Interval, b: Interval, travelMinutes: number): boolean {
  const buffer = bufferBetween(a, b, travelMinutes) * MINUTE;
  return +a.startTime < +b.endTime + buffer && +b.startTime < +a.endTime + buffer;
}

export function freeWindows(windows: Interval[], occupied: Interval[], location: string | null, travelMinutes: number): Interval[] {
  const padded = occupied.map(item => {
    const padding = bufferBetween(item, { ...item, location }, travelMinutes);
    return { startTime: addMinutes(item.startTime, -padding), endTime: addMinutes(item.endTime, padding) };
  }).sort((a, b) => +a.startTime - +b.startTime);
  return windows.flatMap(window => {
    let cursor = +window.startTime;
    const result: Interval[] = [];
    for (const item of padded) {
      if (+item.endTime <= cursor || +item.startTime >= +window.endTime) continue;
      if (+item.startTime > cursor) result.push({ startTime: new Date(cursor), endTime: new Date(Math.min(+window.endTime, +item.startTime)), location });
      cursor = Math.max(cursor, +item.endTime);
      if (cursor >= +window.endTime) break;
    }
    if (cursor < +window.endTime) result.push({ startTime: new Date(cursor), endTime: window.endTime, location });
    return result;
  });
}

/** Pure planning: no persistence, no mutation of existing blocks, no partial task commits. */
export function buildPlan(input: {
  user: PlanningSettings; from: Date; to: Date; tasks: PlanningTask[];
  occupied: Interval[]; existingBlocks: Array<Interval & { taskId: string }>;
}): Plan {
  const { user, from, to } = input;
  const windows = allowedWindows(user, from, to);
  const occupied = [...input.occupied];
  const blocks: PlanBlock[] = [];
  const unscheduled: UnscheduledTask[] = [];
  const tasks = [...input.tasks].sort((a, b) => priority[a.priority] - priority[b.priority] || +a.deadline - +b.deadline || +a.createdAt - +b.createdAt || a.id.localeCompare(b.id));
  for (const task of tasks) {
    const existing = input.existingBlocks.filter(b => b.taskId === task.id);
    const already = existing.reduce((total, b) => total + (+b.endTime - +b.startTime) / MINUTE, 0);
    let remaining = Math.max(0, task.durationMinutes - already);
    if (remaining === 0) continue;
    const fail = (reason: UnscheduledTask['reason']) => unscheduled.push({ taskId: task.id, title: task.title, reason });
    if (+task.deadline <= +from) { fail('DEADLINE_PASSED'); continue; }
    if (remaining < user.minBlockMinutes) { fail('BELOW_MINIMUM'); continue; }
    if (!task.isSplittable && existing.length) { fail('PARTIAL_UNSPLITTABLE'); continue; }
    const location = task.location || user.studyLocation || null;
    const free = freeWindows(windows, occupied, location, user.travelMinutes);
    const tentative: PlanBlock[] = [];
    for (const slot of free) {
      // `free` was calculated before any pieces of this task existed.  Keep
      // later pieces consistent with the acceptance-time conflict check too:
      // an unknown location still needs the configured travel buffer.  This
      // matters when a short custom break creates two otherwise-adjacent
      // allowed windows.  A known, matching location correctly needs no gap.
      const previousEndWithBuffer = tentative.reduce((latest, previous) => (
        Math.max(latest, +previous.endTime + bufferBetween(previous, { ...slot, location }, user.travelMinutes) * MINUTE)
      ), -Infinity);
      const startTime = new Date(Math.max(+slot.startTime, previousEndWithBuffer));
      const available = Math.floor((Math.min(+slot.endTime, +task.deadline) - +startTime) / MINUTE);
      if (available < user.minBlockMinutes || (!task.isSplittable && available < remaining)) continue;
      let chunk = Math.min(remaining, available);
      // Leave enough work for the final block: 70 minutes in two 60-minute
      // slots with a 30-minute minimum becomes 40 + 30, never 60 + 10.
      if (remaining > chunk && remaining - chunk < user.minBlockMinutes) chunk = remaining - user.minBlockMinutes;
      if (chunk < user.minBlockMinutes) continue;
      tentative.push({ taskId: task.id, taskTitle: task.title, startTime, endTime: addMinutes(startTime, chunk), location });
      remaining -= chunk;
      if (!remaining) break;
    }
    if (remaining) { fail('INSUFFICIENT_TIME'); continue; }
    blocks.push(...tentative);
    occupied.push(...tentative);
  }
  return { blocks: blocks.sort((a, b) => +a.startTime - +b.startTime), unscheduled };
}
