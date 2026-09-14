import { type Prisma } from '@personal-schedule/database';
import { ApiError } from '../../lib/errors.js';
import { bumpVersion, withUser } from '../../lib/transaction.js';
import { eventInput } from '../../lib/validation.js';
import { conflicts, type Interval } from './planner.js';

export async function checkEventConflicts(tx: Prisma.TransactionClient, userId: string, interval: Interval, excludeId?: string, schoolImport = false) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const pad = user.travelMinutes * 60_000;
  const time = { startTime: { lt: new Date(+interval.endTime + pad) }, endTime: { gt: new Date(+interval.startTime - pad) } };
  const [events, blocks] = await Promise.all([
    tx.event.findMany({ where: { userId, id: excludeId ? { not: excludeId } : undefined, status: { not: 'CANCELLED' }, ...time } }),
    tx.taskScheduleBlock.findMany({ where: { userId, status: { not: 'CANCELLED' }, ...time } }),
  ]);
  // Fixed school meetings retain their published clock times (some have only a
  // five-minute room change). They may not overlap, but a personal travel
  // preference must not make an otherwise valid official timetable impossible
  // to import. Keep the full buffer against tasks and personal events.
  if (events.some(item => conflicts(interval, item, schoolImport && item.source === 'SCHOOL_PORTAL' ? 0 : user.travelMinutes))
    || blocks.some(item => conflicts(interval, item, user.travelMinutes))) throw new ApiError(409, 'TIME_CONFLICT');
}

interface EventChangePayload {
  externalId?: string;
  eventId?: string; expectedUpdatedAt?: string;
  action: 'CANCEL' | 'UPDATE' | 'CREATE' | 'REVIEW';
  changes?: Record<string, unknown>;
  evidence: { source: 'UED' | 'OUTLOOK'; subject: string; excerpt: string };
}

export async function acceptEventChange(userId: string, suggestionId: string) {
  return withUser(userId, async tx => {
    const suggestion = await tx.suggestion.findFirst({ where: { id: suggestionId, userId, kind: 'EVENT_CHANGE' } });
    if (!suggestion) throw new ApiError(404, 'NOT_FOUND');
    if (suggestion.status === 'ACCEPTED') return { accepted: true, alreadyAccepted: true };
    if (suggestion.status !== 'PENDING' || +suggestion.expiresAt <= Date.now()) throw new ApiError(409, 'SUGGESTION_EXPIRED');
    const payload = suggestion.payload as unknown as EventChangePayload;
    if (payload.action === 'REVIEW') throw new ApiError(409, 'MANUAL_REVIEW_REQUIRED');
    if (payload.action === 'CREATE') {
      const input = eventInput.parse(payload.changes);
      if (payload.evidence.source !== 'UED' && +input.startTime <= Date.now()) throw new ApiError(409, 'EVENT_IN_PAST');
      await checkEventConflicts(tx, userId, input, undefined, payload.evidence.source === 'UED');
      await tx.event.create({ data: { ...input, userId, source: payload.evidence.source === 'UED' ? 'SCHOOL_PORTAL' : 'OUTLOOK', externalId: payload.evidence.source === 'UED' && payload.externalId ? payload.externalId : suggestion.sourceKey, sourceMetadata: { suggestionId } } });
    } else {
      if (!payload.eventId || !payload.expectedUpdatedAt) throw new ApiError(409, 'MANUAL_REVIEW_REQUIRED');
      const event = await tx.event.findFirst({ where: { id: payload.eventId, userId } });
      if (!event) throw new ApiError(404, 'NOT_FOUND');
      if (event.updatedAt.toISOString() !== payload.expectedUpdatedAt || event.status !== 'SCHEDULED') throw new ApiError(409, 'SCHEDULE_CHANGED');
      if (payload.action === 'CANCEL') {
        await tx.event.update({ where: { id: event.id }, data: { status: 'CANCELLED' } });
      } else {
        const input = eventInput.parse({ ...event, startTime: event.startTime.toISOString(), endTime: event.endTime.toISOString(), ...payload.changes });
        if (payload.evidence.source !== 'UED' && +input.startTime <= Date.now()) throw new ApiError(409, 'EVENT_IN_PAST');
        await checkEventConflicts(tx, userId, input, event.id, payload.evidence.source === 'UED');
        await tx.event.update({ where: { id: event.id }, data: input });
      }
    }
    await tx.suggestion.update({ where: { id: suggestionId }, data: { status: 'ACCEPTED', decidedAt: new Date() } });
    await bumpVersion(tx, userId);
    return { accepted: true };
  });
}
