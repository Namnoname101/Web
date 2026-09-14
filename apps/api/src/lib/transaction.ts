import { Prisma, getPrismaClient } from '@personal-schedule/database';
export async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))::text`;
}

export async function withUser<T>(userId: string, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getPrismaClient().$transaction(async tx => {
        await lockUser(tx, userId);
        return operation(tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    } catch (error) {
      if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
    }
  }
}

export async function bumpVersion(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.user.update({ where: { id: userId }, data: { scheduleVersion: { increment: 1 } } });
  await tx.suggestion.updateMany({ where: { userId, status: 'PENDING', kind: 'TASK_PLAN' }, data: { status: 'EXPIRED' } });
}
