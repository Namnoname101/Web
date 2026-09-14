import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { getPrismaClient } from '@personal-schedule/database';

const OVERVIEW_ITEM_LIMIT = 12;

/**
 * Builds an exact half-open interval for one calendar day in the student's
 * timezone. Constructing both local midnights (instead of adding 24 hours)
 * also keeps this correct for timezones that observe daylight-saving time.
 */
export function agendaDayBounds(now: Date, timezone: string) {
  const localDate = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const calendarDate = new Date(`${localDate}T12:00:00.000Z`);
  calendarDate.setUTCDate(calendarDate.getUTCDate() + 1);
  const nextLocalDate = calendarDate.toISOString().slice(0, 10);

  return {
    localDate,
    dayStart: fromZonedTime(`${localDate}T00:00:00`, timezone),
    dayEnd: fromZonedTime(`${nextLocalDate}T00:00:00`, timezone),
  };
}

/**
 * Dashboard-specific agenda data. It deliberately does not use the calendar
 * week's requested range: the next confirmed item may be weeks away, while a
 * student's "today" must always follow their configured timezone.
 */
export async function getAgendaOverview(userId: string, timezone: string, now = new Date()) {
  const prisma = getPrismaClient();
  const { localDate, dayStart, dayEnd } = agendaDayBounds(now, timezone);
  const overlapsToday = { startTime: { lt: dayEnd }, endTime: { gt: dayStart } };

  const [todayEvents, todayBlocks, upcomingEvents, upcomingBlocks, pastEvents, pastBlocks] = await Promise.all([
    prisma.event.findMany({
      where: { userId, status: { not: 'CANCELLED' }, ...overlapsToday },
      orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }, { id: 'asc' }],
    }),
    prisma.taskScheduleBlock.findMany({
      where: { userId, status: { not: 'CANCELLED' }, ...overlapsToday },
      include: { task: true },
      orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }, { id: 'asc' }],
    }),
    prisma.event.findMany({
      where: { userId, status: 'SCHEDULED', startTime: { gt: now } },
      orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }, { id: 'asc' }],
      take: OVERVIEW_ITEM_LIMIT,
    }),
    prisma.taskScheduleBlock.findMany({
      where: { userId, status: 'SCHEDULED', startTime: { gt: now } },
      include: { task: true },
      orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }, { id: 'asc' }],
      take: OVERVIEW_ITEM_LIMIT,
    }),
    prisma.event.findMany({
      where: { userId, status: { not: 'CANCELLED' }, endTime: { lte: now } },
      orderBy: [{ endTime: 'desc' }, { startTime: 'desc' }, { id: 'asc' }],
      take: OVERVIEW_ITEM_LIMIT,
    }),
    prisma.taskScheduleBlock.findMany({
      where: { userId, status: { not: 'CANCELLED' }, endTime: { lte: now } },
      include: { task: true },
      orderBy: [{ endTime: 'desc' }, { startTime: 'desc' }, { id: 'asc' }],
      take: OVERVIEW_ITEM_LIMIT,
    }),
  ]);

  return {
    asOf: now,
    localDate,
    dayStart,
    dayEnd,
    limit: OVERVIEW_ITEM_LIMIT,
    today: { events: todayEvents, blocks: todayBlocks },
    upcoming: { events: upcomingEvents, blocks: upcomingBlocks },
    past: { events: pastEvents, blocks: pastBlocks },
  };
}
