import { getPrismaClient } from '@personal-schedule/database';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';

export const DEFAULT_TASK_HISTORY_PAGE_SIZE = 50;
export const MAX_TASK_HISTORY_PAGE_SIZE = 100;
export const DEFAULT_TASK_BLOCK_PAGE_SIZE = 50;
export const MAX_TASK_BLOCK_PAGE_SIZE = 100;

const historyCursorValue = z.object({
  updatedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
}).strict();

const blockCursorValue = z.object({
  taskId: z.uuid(),
  startTime: z.iso.datetime({ offset: true }),
  id: z.uuid(),
}).strict();

function decodedCursor(value: string): unknown {
  if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid cursor');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw new Error('non-canonical cursor');
  return JSON.parse(bytes.toString('utf8'));
}

export function encodeTaskHistoryCursor(task: { updatedAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ updatedAt: task.updatedAt.toISOString(), id: task.id })).toString('base64url');
}

export function decodeTaskHistoryCursor(value: string): { updatedAt: Date; id: string } {
  try {
    const parsed = historyCursorValue.parse(decodedCursor(value));
    return { updatedAt: new Date(parsed.updatedAt), id: parsed.id };
  } catch {
    throw new ApiError(400, 'INVALID_TASK_CURSOR');
  }
}

export function encodeTaskBlockCursor(block: { taskId: string; startTime: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ taskId: block.taskId, startTime: block.startTime.toISOString(), id: block.id })).toString('base64url');
}

export function decodeTaskBlockCursor(value: string, taskId: string): { startTime: Date; id: string } {
  try {
    const parsed = blockCursorValue.parse(decodedCursor(value));
    if (parsed.taskId !== taskId) throw new Error('cursor belongs to another task');
    return { startTime: new Date(parsed.startTime), id: parsed.id };
  } catch {
    throw new ApiError(400, 'INVALID_TASK_BLOCK_CURSOR');
  }
}

export async function getTaskHistoryPage(userId: string, cursorValueInput?: string, limit = DEFAULT_TASK_HISTORY_PAGE_SIZE) {
  const cursor = cursorValueInput ? decodeTaskHistoryCursor(cursorValueInput) : null;
  const rows = await getPrismaClient().task.findMany({
    where: {
      userId,
      status: { in: ['COMPLETED', 'CANCELLED'] },
      ...(cursor ? { OR: [
        { updatedAt: { lt: cursor.updatedAt } },
        { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
      ] } : {}),
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const tasks = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return {
    tasks,
    page: {
      hasMore,
      nextCursor: hasMore && tasks.length ? encodeTaskHistoryCursor(tasks[tasks.length - 1]) : null,
    },
  };
}

export async function getTaskStats(userId: string): Promise<{ active: number; completed: number; cancelled: number }> {
  const rows = await getPrismaClient().task.groupBy({
    by: ['status'],
    where: { userId },
    _count: { _all: true },
  });
  const counts = new Map(rows.map(row => [row.status, row._count._all]));
  return {
    active: (counts.get('PENDING') || 0) + (counts.get('IN_PROGRESS') || 0),
    completed: counts.get('COMPLETED') || 0,
    cancelled: counts.get('CANCELLED') || 0,
  };
}

export async function getBootstrapTasks(userId: string) {
  const [active, history, stats] = await Promise.all([
    // Active work stays complete and immediately actionable. Omitting relation
    // previews keeps each row small without imposing an arbitrary task cap.
    getPrismaClient().task.findMany({
      where: { userId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      orderBy: [{ priority: 'asc' }, { deadline: 'asc' }, { id: 'asc' }],
    }),
    getTaskHistoryPage(userId),
    getTaskStats(userId),
  ]);
  return {
    tasks: [...active, ...history.tasks],
    page: history.page,
    stats,
  };
}

export async function getTaskBlockPage(
  userId: string,
  taskId: string,
  cursorValueInput?: string,
  limit = DEFAULT_TASK_BLOCK_PAGE_SIZE,
  now = new Date(),
) {
  const database = getPrismaClient();
  // Return the same result for a missing task and another user's task.
  if (!await database.task.findFirst({ where: { id: taskId, userId }, select: { id: true } })) {
    throw new ApiError(404, 'NOT_FOUND');
  }
  const cursor = cursorValueInput ? decodeTaskBlockCursor(cursorValueInput, taskId) : null;
  const [rows, futureBlock] = await Promise.all([
    database.taskScheduleBlock.findMany({
      where: {
        userId,
        taskId,
        status: { not: 'CANCELLED' },
        ...(cursor ? { OR: [
          { startTime: { lt: cursor.startTime } },
          { startTime: cursor.startTime, id: { lt: cursor.id } },
        ] } : {}),
      },
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    }),
    database.taskScheduleBlock.findFirst({
      where: { userId, taskId, status: 'SCHEDULED', startTime: { gt: now } },
      select: { id: true },
    }),
  ]);
  const blocks = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return {
    blocks,
    hasFutureBlocks: Boolean(futureBlock),
    page: {
      hasMore,
      nextCursor: hasMore && blocks.length ? encodeTaskBlockCursor(blocks[blocks.length - 1]) : null,
    },
  };
}
