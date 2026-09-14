import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@personal-schedule/database';
import { checkEventConflicts } from '../../src/modules/scheduling/event-changes.js';

const meeting = { startTime: new Date('2026-09-15T02:40:00Z'), endTime: new Date('2026-09-15T05:15:00Z'), location: 'B3-401' };
function transaction(source: string, previousEnd = '2026-09-15T02:35:00Z', asTask = false) {
  const previous = { startTime: new Date('2026-09-15T00:00:00Z'), endTime: new Date(previousEnd), location: 'B3-402', source };
  return {
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ travelMinutes: 15 }) },
    event: { findMany: vi.fn().mockResolvedValue(asTask ? [] : [previous]) },
    taskScheduleBlock: { findMany: vi.fn().mockResolvedValue(asTask ? [previous] : []) },
  } as unknown as Prisma.TransactionClient;
}
describe('Official school timetable and personal travel preferences', () => {
  it('preserves the five-minute gap between two fixed school classes', async () => {
    await expect(checkEventConflicts(transaction('SCHOOL_PORTAL'), 'student', meeting, undefined, true)).resolves.toBeUndefined();
  });
  it('still rejects actual overlapping school meetings', async () => {
    await expect(checkEventConflicts(transaction('SCHOOL_PORTAL', '2026-09-15T02:45:00Z'), 'student', meeting, undefined, true)).rejects.toMatchObject({ code: 'TIME_CONFLICT' });
  });
  it('keeps travel buffers against personal meetings and tasks, and for manual entries', async () => {
    for (const [tx, importing] of [[transaction('MANUAL'), true], [transaction('SCHOOL_PORTAL'), false], [transaction('MANUAL', undefined, true), true]] as const) {
      await expect(checkEventConflicts(tx, 'student', meeting, undefined, importing)).rejects.toMatchObject({ code: 'TIME_CONFLICT' });
    }
  });
});
