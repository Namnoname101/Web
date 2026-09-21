import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  taskFindMany: vi.fn(),
  taskFindFirst: vi.fn(),
  taskGroupBy: vi.fn(),
  blockFindMany: vi.fn(),
  blockFindFirst: vi.fn(),
}));

vi.mock('@personal-schedule/database', () => ({
  getPrismaClient: () => ({
    task: { findMany: fixture.taskFindMany, findFirst: fixture.taskFindFirst, groupBy: fixture.taskGroupBy },
    taskScheduleBlock: { findMany: fixture.blockFindMany, findFirst: fixture.blockFindFirst },
  }),
}));

import { ApiError } from '../../src/lib/errors.js';
import {
  decodeTaskBlockCursor,
  decodeTaskHistoryCursor,
  encodeTaskBlockCursor,
  encodeTaskHistoryCursor,
  getBootstrapTasks,
  getTaskBlockPage,
  getTaskStats,
} from '../../src/modules/tasks/task-history.js';

const taskA = '10000000-0000-4000-8000-000000000001';
const taskB = '20000000-0000-4000-8000-000000000002';
const blockA = '30000000-0000-4000-8000-000000000003';

function expectApiCode(operation: () => unknown, code: string) {
  try { operation(); throw new Error('expected rejection'); }
  catch (error) { expect(error).toBeInstanceOf(ApiError); expect((error as ApiError).code).toBe(code); }
}

describe('task history cursor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('round-trips a stable updated-at and id boundary', () => {
    const value = { updatedAt: new Date('2030-09-14T05:00:00.123Z'), id: taskA };
    expect(decodeTaskHistoryCursor(encodeTaskHistoryCursor(value))).toEqual(value);
  });

  it('rejects malformed and oversized cursors with a public API code', () => {
    for (const value of ['not-json', Buffer.from('{}').toString('base64url'), 'e30=', 'x'.repeat(513)]) {
      expectApiCode(() => decodeTaskHistoryCursor(value), 'INVALID_TASK_CURSOR');
    }
  });

  it('round-trips task-scoped block cursors and rejects cross-task reuse', () => {
    const value = { taskId: taskA, startTime: new Date('2030-09-14T05:00:00.123Z'), id: blockA };
    const encoded = encodeTaskBlockCursor(value);
    expect(decodeTaskBlockCursor(encoded, taskA)).toEqual({ startTime: value.startTime, id: blockA });
    expectApiCode(() => decodeTaskBlockCursor(encoded, taskB), 'INVALID_TASK_BLOCK_CURSOR');
  });

  it('builds authoritative task counts independently of loaded history', async () => {
    fixture.taskGroupBy.mockResolvedValue([
      { status: 'PENDING', _count: { _all: 7 } },
      { status: 'IN_PROGRESS', _count: { _all: 3 } },
      { status: 'COMPLETED', _count: { _all: 90 } },
    ]);

    await expect(getTaskStats('user-1')).resolves.toEqual({ active: 10, completed: 90, cancelled: 0 });
    expect(fixture.taskGroupBy).toHaveBeenCalledWith({ by: ['status'], where: { userId: 'user-1' }, _count: { _all: true } });
  });

  it('returns every active task without relation previews plus one bounded history page', async () => {
    const active = [{ id: taskA, status: 'PENDING' }, { id: taskB, status: 'IN_PROGRESS' }];
    const closed = [{ id: blockA, status: 'COMPLETED', updatedAt: new Date('2030-01-01T00:00:00Z') }];
    fixture.taskFindMany.mockImplementation(async options => options.where.status.in.includes('PENDING') ? active : closed);
    fixture.taskGroupBy.mockResolvedValue([
      { status: 'PENDING', _count: { _all: 1 } },
      { status: 'IN_PROGRESS', _count: { _all: 1 } },
      { status: 'COMPLETED', _count: { _all: 1 } },
    ]);

    await expect(getBootstrapTasks('user-1')).resolves.toEqual({
      tasks: [...active, ...closed],
      page: { hasMore: false, nextCursor: null },
      stats: { active: 2, completed: 1, cancelled: 0 },
    });
    const activeQuery = fixture.taskFindMany.mock.calls.find(([options]) => options.where.status.in.includes('PENDING'))![0];
    expect(activeQuery).not.toHaveProperty('take');
    expect(activeQuery).not.toHaveProperty('include');
    const historyQuery = fixture.taskFindMany.mock.calls.find(([options]) => options.where.status.in.includes('COMPLETED'))![0];
    expect(historyQuery.take).toBe(51);
    expect(historyQuery).not.toHaveProperty('include');
  });

  it('pages non-cancelled blocks and reports future blocks from the complete task', async () => {
    const now = new Date('2030-01-01T00:00:00Z');
    const rows = [0, 1, 2].map(index => ({
      id: `${index + 3}0000000-0000-4000-8000-00000000000${index + 3}`,
      taskId: taskA,
      startTime: new Date(+now - index * 60_000),
    }));
    fixture.taskFindFirst.mockResolvedValue({ id: taskA });
    fixture.blockFindMany.mockResolvedValue(rows);
    fixture.blockFindFirst.mockResolvedValue({ id: 'future' });

    const result = await getTaskBlockPage('user-1', taskA, undefined, 2, now);
    expect(result.blocks).toEqual(rows.slice(0, 2));
    expect(result.hasFutureBlocks).toBe(true);
    expect(result.page.hasMore).toBe(true);
    expect(decodeTaskBlockCursor(result.page.nextCursor!, taskA)).toEqual({ startTime: rows[1].startTime, id: rows[1].id });
    expect(fixture.blockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', taskId: taskA, status: { not: 'CANCELLED' } },
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
      take: 3,
    }));
    expect(fixture.blockFindFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', taskId: taskA, status: 'SCHEDULED', startTime: { gt: now } },
      select: { id: true },
    });
  });

  it('returns not found for a foreign task without querying its blocks', async () => {
    fixture.taskFindFirst.mockResolvedValue(null);

    await expect(getTaskBlockPage('user-1', taskA)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(fixture.blockFindMany).not.toHaveBeenCalled();
    expect(fixture.blockFindFirst).not.toHaveBeenCalled();
  });
});
