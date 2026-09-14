import { type Prisma, type PrismaClient, getPrismaClient } from '@personal-schedule/database';
import { addMinutes } from 'date-fns';
import { ApiError } from '../../lib/errors.js';
import { bumpVersion, lockUser } from '../../lib/transaction.js';
import { buildPlan, allowedWindows, conflicts, type PlanBlock, type Plan, type Interval } from './planner.js';

interface StoredPlan {
  fromDate: string; toDate: string;
  blocks: Array<{ taskId: string; taskTitle: string; startTime: string; endTime: string; location: string | null }>;
  unscheduled: Plan['unscheduled'];
}

export class SchedulingService {
  constructor(private readonly database: PrismaClient = getPrismaClient()) {}

  /** Returns a saved proposal. The user's accepted calendar remains unchanged. */
  async runAutoRescheduler(userId: string, fromDate: Date, toDate: Date) {
    const from = new Date(Math.max(+fromDate, +addMinutes(new Date(), 2)));
    if (+toDate <= +from || +toDate - +from > 90 * 86_400_000) throw new ApiError(400, 'INVALID_RANGE');
    return this.database.$transaction(async tx => {
      await lockUser(tx, userId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const padding = user.travelMinutes * 60_000;
      const whereTime = { startTime: { lt: new Date(+toDate + padding) }, endTime: { gt: new Date(+from - padding) } };
      const [events, occupied, tasks] = await Promise.all([
        tx.event.findMany({ where: { userId, status: { not: 'CANCELLED' }, ...whereTime } }),
        tx.taskScheduleBlock.findMany({ where: { userId, status: { not: 'CANCELLED' }, ...whereTime } }),
        tx.task.findMany({ where: { userId, status: { in: ['PENDING', 'IN_PROGRESS'] }, isScheduled: false }, include: { scheduleBlocks: { where: { status: 'SCHEDULED' } } } }),
      ]);
      const plan = buildPlan({ user, from, to: toDate, tasks, occupied: [...events, ...occupied], existingBlocks: tasks.flatMap(t => t.scheduleBlocks) });
      const payload: StoredPlan = {
        fromDate: from.toISOString(), toDate: toDate.toISOString(),
        blocks: plan.blocks.map(b => ({ ...b, startTime: b.startTime.toISOString(), endTime: b.endTime.toISOString(), location: b.location || null })),
        unscheduled: plan.unscheduled,
      };
      await tx.suggestion.updateMany({ where: { userId, kind: 'TASK_PLAN', status: 'PENDING' }, data: { status: 'EXPIRED' } });
      const suggestion = await tx.suggestion.create({ data: {
        userId, kind: 'TASK_PLAN', titleVi: 'Đề xuất sắp xếp công việc', titleEn: 'Your suggested study plan',
        payload: payload as unknown as Prisma.InputJsonValue, baseVersion: user.scheduleVersion,
        expiresAt: new Date(Math.min(Date.now() + 24 * 3_600_000, plan.blocks[0] ? +plan.blocks[0].startTime : +toDate)),
      } });
      if (plan.blocks.length && user.notificationsEnabled) await tx.notification.create({ data: {
        userId, dedupeKey: `task-plan:${suggestion.id}`, titleVi: 'Lịch gợi ý đã sẵn sàng', titleEn: 'Your study plan is ready',
        bodyVi: `${plan.blocks.length} phiên học đang chờ bạn xem và xác nhận.`, bodyEn: `${plan.blocks.length} study sessions are waiting for your approval.`,
      } });
      return suggestion;
    }, { timeout: 15_000 });
  }

  async accept(userId: string, suggestionId: string) {
    return this.database.$transaction(async tx => {
      await lockUser(tx, userId);
      const suggestion = await tx.suggestion.findFirst({ where: { id: suggestionId, userId, kind: 'TASK_PLAN' } });
      if (!suggestion) throw new ApiError(404, 'NOT_FOUND');
      if (suggestion.status === 'ACCEPTED') return { accepted: true, alreadyAccepted: true };
      if (suggestion.status !== 'PENDING' || +suggestion.expiresAt <= Date.now()) throw new ApiError(409, 'SUGGESTION_EXPIRED');
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.scheduleVersion !== suggestion.baseVersion) throw new ApiError(409, 'SCHEDULE_CHANGED');
      const payload = suggestion.payload as unknown as StoredPlan;
      const blocks: PlanBlock[] = payload.blocks.map(b => ({ ...b, startTime: new Date(b.startTime), endTime: new Date(b.endTime) }));
      if (!blocks.length) throw new ApiError(400, 'EMPTY_PLAN');
      const from = new Date(payload.fromDate), to = new Date(payload.toDate);
      const windows = allowedWindows(user, from, to);
      const padding = user.travelMinutes * 60_000;
      const timeWhere = { startTime: { lt: new Date(+to + padding) }, endTime: { gt: new Date(+from - padding) } };
      const events = await tx.event.findMany({ where: { userId, status: { not: 'CANCELLED' }, ...timeWhere } });
      const existing = await tx.taskScheduleBlock.findMany({ where: { userId, status: { not: 'CANCELLED' }, ...timeWhere } });
      const occupied: Interval[] = [...events, ...existing];
      const tasks = await tx.task.findMany({ where: { userId, id: { in: [...new Set(blocks.map(b => b.taskId))] }, status: { in: ['PENDING', 'IN_PROGRESS'] } }, include: { scheduleBlocks: { where: { status: 'SCHEDULED' } } } });
      for (const block of blocks) {
        const task = tasks.find(t => t.id === block.taskId);
        if (!task || task.isScheduled || +block.startTime < Date.now() || +block.endTime > +task.deadline) throw new ApiError(409, 'PLAN_NO_LONGER_VALID');
        if ((+block.endTime - +block.startTime) / 60_000 < user.minBlockMinutes || !windows.some(w => +w.startTime <= +block.startTime && +block.endTime <= +w.endTime)) throw new ApiError(409, 'INVALID_PLAN_WINDOW');
        if (occupied.some(b => conflicts(block, b, user.travelMinutes))) throw new ApiError(409, 'TIME_CONFLICT');
        occupied.push(block);
      }
      for (const task of tasks) {
        const pieces = blocks.filter(b => b.taskId === task.id);
        const total = [...pieces, ...task.scheduleBlocks].reduce((n, b) => n + (+b.endTime - +b.startTime) / 60_000, 0);
        if (total !== task.durationMinutes || (!task.isSplittable && pieces.length + task.scheduleBlocks.length !== 1)) throw new ApiError(409, 'INVALID_PLAN_DURATION');
      }
      await tx.taskScheduleBlock.createMany({ data: blocks.map(({ taskTitle: _title, ...block }) => ({ ...block, userId, origin: 'AUTO' })) });
      await tx.task.updateMany({ where: { userId, id: { in: tasks.map(t => t.id) } }, data: { isScheduled: true } });
      await tx.suggestion.update({ where: { id: suggestion.id }, data: { status: 'ACCEPTED', decidedAt: new Date() } });
      await bumpVersion(tx, userId);
      return { accepted: true, createdBlocks: blocks.length };
    }, { timeout: 15_000 });
  }
}

export function runAutoRescheduler(userId: string, fromDate: Date, toDate: Date) {
  return new SchedulingService().runAutoRescheduler(userId, fromDate, toDate);
}
