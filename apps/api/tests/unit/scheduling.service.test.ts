import { afterEach, describe, expect, it, vi } from 'vitest';
import { SchedulingService } from '../../src/modules/scheduling/scheduling.service.js';

describe('active task planning', () => {
  afterEach(() => vi.useRealTimers());

  it('loads pending and in-progress unscheduled tasks into a proposal', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-09-12T00:00:00.000Z'));

    const user = {
      id: 'student-1', scheduleVersion: 4, notificationsEnabled: false,
      activeStartTime: '07:00', activeEndTime: '22:00', breakStartTime: '11:30', breakEndTime: '13:00',
      timezone: 'Asia/Ho_Chi_Minh', minBlockMinutes: 30, travelMinutes: 0, studyLocation: null,
    };
    const activeTask = {
      id: 'task-in-progress', userId: user.id, title: 'Continue assignment', notes: '', location: null,
      durationMinutes: 30, deadline: new Date('2030-09-12T03:00:00.000Z'), priority: 'HIGH',
      status: 'IN_PROGRESS', isSplittable: true, isScheduled: false,
      createdAt: new Date('2030-09-11T00:00:00.000Z'), updatedAt: new Date('2030-09-11T00:00:00.000Z'),
      completedAt: null, scheduleBlocks: [],
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      user: { findUniqueOrThrow: vi.fn().mockResolvedValue(user) },
      event: { findMany: vi.fn().mockResolvedValue([]) },
      taskScheduleBlock: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: vi.fn().mockResolvedValue([activeTask]) },
      suggestion: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'proposal-1', ...data })),
      },
      notification: { create: vi.fn() },
    };
    const database = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
    };

    const proposal = await new SchedulingService(database as never).runAutoRescheduler(
      user.id,
      new Date('2030-09-12T00:05:00.000Z'),
      new Date('2030-09-12T02:00:00.000Z'),
    );

    expect(tx.task.findMany).toHaveBeenCalledWith({
      where: { userId: user.id, status: { in: ['PENDING', 'IN_PROGRESS'] }, isScheduled: false },
      include: { scheduleBlocks: { where: { status: 'SCHEDULED' } } },
    });
    expect((proposal.payload as { blocks: Array<{ taskId: string }> }).blocks).toEqual([
      expect.objectContaining({ taskId: activeTask.id }),
    ]);
  });

  it('accepts an in-progress task plan without rewriting the task status', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-09-12T00:00:00.000Z'));

    const user = {
      id: 'student-1', scheduleVersion: 4,
      activeStartTime: '07:00', activeEndTime: '22:00', breakStartTime: '11:30', breakEndTime: '13:00',
      timezone: 'Asia/Ho_Chi_Minh', minBlockMinutes: 30, travelMinutes: 0, studyLocation: null,
    };
    const activeTask = {
      id: 'task-in-progress', userId: user.id, title: 'Continue assignment', notes: '', location: null,
      durationMinutes: 30, deadline: new Date('2030-09-12T03:00:00.000Z'), priority: 'HIGH',
      status: 'IN_PROGRESS', isSplittable: true, isScheduled: false,
      createdAt: new Date('2030-09-11T00:00:00.000Z'), updatedAt: new Date('2030-09-11T00:00:00.000Z'),
      completedAt: null, scheduleBlocks: [],
    };
    const suggestion = {
      id: 'proposal-1', userId: user.id, kind: 'TASK_PLAN', status: 'PENDING', baseVersion: 4,
      expiresAt: new Date('2030-09-12T01:00:00.000Z'),
      payload: {
        fromDate: '2030-09-12T00:05:00.000Z', toDate: '2030-09-12T02:00:00.000Z', unscheduled: [],
        blocks: [{ taskId: activeTask.id, taskTitle: activeTask.title, startTime: '2030-09-12T00:05:00.000Z', endTime: '2030-09-12T00:35:00.000Z', location: null }],
      },
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(user),
        update: vi.fn().mockResolvedValue({ ...user, scheduleVersion: 5 }),
      },
      event: { findMany: vi.fn().mockResolvedValue([]) },
      taskScheduleBlock: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      task: {
        findMany: vi.fn().mockResolvedValue([activeTask]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      suggestion: {
        findFirst: vi.fn().mockResolvedValue(suggestion),
        update: vi.fn().mockResolvedValue({ ...suggestion, status: 'ACCEPTED' }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const database = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
    };

    await expect(new SchedulingService(database as never).accept(user.id, suggestion.id)).resolves.toMatchObject({
      accepted: true,
      createdBlocks: 1,
    });

    expect(tx.task.findMany).toHaveBeenCalledWith({
      where: { userId: user.id, id: { in: [activeTask.id] }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      include: { scheduleBlocks: { where: { status: 'SCHEDULED' } } },
    });
    expect(tx.task.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, id: { in: [activeTask.id] } },
      data: { isScheduled: true },
    });
  });
});
