import { getPrismaClient, type Prisma } from '@personal-schedule/database';

type DbClient = Prisma.TransactionClient | ReturnType<typeof getPrismaClient>;

/**
 * Creates a scoped database accessor that guarantees queries are partitioned by `userId`.
 * This provides defense-in-depth against Insecure Direct Object References (IDOR).
 */
export function scopedDb(userId: string, client?: DbClient) {
  const db = client ?? getPrismaClient();

  const scopeWhere = <T extends { where?: Record<string, unknown> } | undefined>(args: T): T => {
    return {
      ...(args ?? {}),
      where: {
        ...(args?.where ?? {}),
        userId,
      },
    } as unknown as T;
  };

  const scopeData = <T extends { data: Record<string, unknown> }>(args: T): T => {
    return {
      ...args,
      data: {
        ...args.data,
        userId,
      },
    } as unknown as T;
  };

  return {
    raw: db,
    event: {
      findMany: (args?: Parameters<typeof db.event.findMany>[0]) => db.event.findMany(scopeWhere(args)),
      findFirst: (args?: Parameters<typeof db.event.findFirst>[0]) => db.event.findFirst(scopeWhere(args)),
      count: (args?: Parameters<typeof db.event.count>[0]) => db.event.count(scopeWhere(args)),
      create: (args: Parameters<typeof db.event.create>[0]) => db.event.create(scopeData(args)),
      update: (args: Parameters<typeof db.event.update>[0]) => db.event.update(args),
      updateMany: (args: Parameters<typeof db.event.updateMany>[0]) => db.event.updateMany(scopeWhere(args)),
      deleteMany: (args?: Parameters<typeof db.event.deleteMany>[0]) => db.event.deleteMany(scopeWhere(args)),
    },
    task: {
      findMany: (args?: Parameters<typeof db.task.findMany>[0]) => db.task.findMany(scopeWhere(args)),
      findFirst: (args?: Parameters<typeof db.task.findFirst>[0]) => db.task.findFirst(scopeWhere(args)),
      count: (args?: Parameters<typeof db.task.count>[0]) => db.task.count(scopeWhere(args)),
      create: (args: Parameters<typeof db.task.create>[0]) => db.task.create(scopeData(args)),
      update: (args: Parameters<typeof db.task.update>[0]) => db.task.update(args),
      updateMany: (args: Parameters<typeof db.task.updateMany>[0]) => db.task.updateMany(scopeWhere(args)),
      deleteMany: (args?: Parameters<typeof db.task.deleteMany>[0]) => db.task.deleteMany(scopeWhere(args)),
    },
    taskScheduleBlock: {
      findMany: (args?: Parameters<typeof db.taskScheduleBlock.findMany>[0]) => db.taskScheduleBlock.findMany(scopeWhere(args)),
      findFirst: (args?: Parameters<typeof db.taskScheduleBlock.findFirst>[0]) => db.taskScheduleBlock.findFirst(scopeWhere(args)),
      count: (args?: Parameters<typeof db.taskScheduleBlock.count>[0]) => db.taskScheduleBlock.count(scopeWhere(args)),
      create: (args: Parameters<typeof db.taskScheduleBlock.create>[0]) => db.taskScheduleBlock.create(scopeData(args)),
      updateMany: (args: Parameters<typeof db.taskScheduleBlock.updateMany>[0]) => db.taskScheduleBlock.updateMany(scopeWhere(args)),
      deleteMany: (args?: Parameters<typeof db.taskScheduleBlock.deleteMany>[0]) => db.taskScheduleBlock.deleteMany(scopeWhere(args)),
    },
    suggestion: {
      findMany: (args?: Parameters<typeof db.suggestion.findMany>[0]) => db.suggestion.findMany(scopeWhere(args)),
      findFirst: (args?: Parameters<typeof db.suggestion.findFirst>[0]) => db.suggestion.findFirst(scopeWhere(args)),
      updateMany: (args: Parameters<typeof db.suggestion.updateMany>[0]) => db.suggestion.updateMany(scopeWhere(args)),
      deleteMany: (args?: Parameters<typeof db.suggestion.deleteMany>[0]) => db.suggestion.deleteMany(scopeWhere(args)),
    },
    notification: {
      findMany: (args?: Parameters<typeof db.notification.findMany>[0]) => db.notification.findMany(scopeWhere(args)),
      findFirst: (args?: Parameters<typeof db.notification.findFirst>[0]) => db.notification.findFirst(scopeWhere(args)),
      updateMany: (args: Parameters<typeof db.notification.updateMany>[0]) => db.notification.updateMany(scopeWhere(args)),
    },
    integration: {
      findMany: (args?: Parameters<typeof db.integration.findMany>[0]) => db.integration.findMany(scopeWhere(args)),
      findFirst: (args?: Parameters<typeof db.integration.findFirst>[0]) => db.integration.findFirst(scopeWhere(args)),
      updateMany: (args: Parameters<typeof db.integration.updateMany>[0]) => db.integration.updateMany(scopeWhere(args)),
    },
    academicRecord: {
      findMany: (args?: Parameters<typeof db.academicRecord.findMany>[0]) => db.academicRecord.findMany(scopeWhere(args)),
    },
  };
}
