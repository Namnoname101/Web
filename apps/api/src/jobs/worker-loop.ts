import { randomUUID } from 'node:crypto';
import { getPrismaClient } from '@personal-schedule/database';
import { syncOutlook } from '../modules/integrations/outlook/outlook.service.js';
import { syncUed } from '../modules/integrations/ued/ued.service.js';
import { ApiError } from '../lib/errors.js';
import { safeErrorSummary } from '../lib/safe-error.js';

const LEASE_MS = 5 * 60_000;
const AUTH_CLEANUP_INTERVAL_MS = 5 * 60_000;
const REMINDER_BATCH_SIZE = 500;
const REMINDER_MAX_BATCHES = 10;
let reminderLastRun = 0;
let authCleanupLastRun = 0;

/** Keep worker diagnostics useful without ever serializing an exception's
 * message, query, response body, token, or student content into logs. */
export const workerErrorSummary = safeErrorSummary;

/** Persisted leases survive crashes; tokens prevent an old worker from
 * clearing or renewing a replacement worker's lease after expiry. */
export async function workerTick(): Promise<void> {
  const db = getPrismaClient();
  const now = new Date();
  const candidate = await db.integration.findFirst({
    where: { status: 'CONNECTED', nextSyncAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    orderBy: { nextSyncAt: 'asc' },
  });
  if (candidate) {
    const leaseToken = randomUUID();
    const claimed = await db.integration.updateMany({ where: { id: candidate.id, status: 'CONNECTED', nextSyncAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { leaseToken, lockedUntil: new Date(+now + LEASE_MS) } });
    if (claimed.count) {
      const heartbeat = setInterval(() => {
        void db.integration.updateMany({ where: { id: candidate.id, leaseToken }, data: { lockedUntil: new Date(Date.now() + LEASE_MS) } }).catch(() => console.error('Worker heartbeat unavailable'));
      }, 30_000);
      heartbeat.unref();
      try {
        if (candidate.provider === 'OUTLOOK') await syncOutlook(candidate.id);
        else await syncUed(candidate.id);
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'SYNC_FAILED';
        console.warn('Integration sync deferred', { provider: candidate.provider, code });
        // Outlook owns its own cursor/backoff. UED errors retry with capped backoff.
        if (candidate.provider === 'UED') await db.integration.updateMany({
          where: { id: candidate.id, leaseToken, status: 'CONNECTED', encryptedSecret: candidate.encryptedSecret },
          data: { lastError: code, failures: { increment: 1 }, nextSyncAt: new Date(Date.now() + Math.min(3_600_000, 60_000 * 2 ** Math.min(candidate.failures, 6))) },
        });
      } finally {
        clearInterval(heartbeat);
        await db.integration.updateMany({ where: { id: candidate.id, leaseToken }, data: { lockedUntil: null, leaseToken: null } });
      }
    }
  }
  if (Date.now() - reminderLastRun > 60_000) {
    await createDeadlineReminders(); reminderLastRun = Date.now();
  }
  if (Date.now() - authCleanupLastRun > AUTH_CLEANUP_INTERVAL_MS) {
    await cleanupExpiredAuthentication(); authCleanupLastRun = Date.now();
  }
}

/**
 * Insert reminder rows straight from the eligible set. NOT EXISTS is part of
 * the database query, so an already-reminded first page cannot starve students
 * whose deadlines sort later. Batches bound one worker tick while the next tick
 * naturally continues with the first still-missing reminder.
 */
export async function createDeadlineReminders(): Promise<number> {
  const db = getPrismaClient();
  const now = new Date();
  const cutoff = new Date(+now + 24 * 3_600_000);
  let total = 0;
  for (let batch = 0; batch < REMINDER_MAX_BATCHES; batch++) {
    const inserted = Number(await db.$executeRaw`
      WITH eligible AS (
        SELECT t."id", t."user_id", t."title", t."deadline",
          ('deadline:' || t."id"::text || ':' ||
            to_char(t."deadline", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::varchar(512) AS dedupe_key
        FROM "tasks" t
        JOIN "users" u ON u."id" = t."user_id"
        WHERE t."status" IN ('PENDING', 'IN_PROGRESS')
          AND t."deadline" > ${now}
          AND t."deadline" <= ${cutoff}
          AND u."notifications_enabled" = true
          AND NOT EXISTS (
            SELECT 1 FROM "notifications" n
            WHERE n."user_id" = t."user_id"
              AND n."dedupe_key" = ('deadline:' || t."id"::text || ':' ||
                to_char(t."deadline", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
          )
        ORDER BY t."deadline" ASC, t."id" ASC
        LIMIT ${REMINDER_BATCH_SIZE}
      )
      INSERT INTO "notifications" (
        "id", "user_id", "title_vi", "title_en", "body_vi", "body_en", "dedupe_key", "created_at"
      )
      SELECT gen_random_uuid(), e."user_id",
        'Công việc sắp đến hạn', 'An upcoming deadline',
        '“' || e."title" || '” còn chưa đầy 24 giờ. Kiểm tra lịch và tiến độ của bạn.',
        '“' || e."title" || '” is due in less than 24 hours. Check your plan and progress.',
        e.dedupe_key, ${now}
      FROM eligible e
      ON CONFLICT ("user_id", "dedupe_key") DO NOTHING
    `);
    total += inserted;
    if (inserted < REMINDER_BATCH_SIZE) break;
  }
  return total;
}

/** Remove server-side credentials that can no longer authenticate anyone. */
export async function cleanupExpiredAuthentication(now = new Date()): Promise<{ sessions: number; oauthAttempts: number }> {
  const db = getPrismaClient();
  const [sessions, oauthAttempts] = await Promise.all([
    db.session.deleteMany({ where: { expiresAt: { lte: now } } }),
    db.oAuthAttempt.deleteMany({ where: { expiresAt: { lte: now } } }),
  ]);
  return { sessions: sessions.count, oauthAttempts: oauthAttempts.count };
}

export function startWorkerLoop(): () => Promise<void> {
  let stopping = false;
  let active: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    if (stopping) return;
    active = workerTick().catch(error => console.error('Worker tick deferred', workerErrorSummary(error))).finally(() => {
      if (!stopping) { timer = setTimeout(tick, 10_000); timer.unref(); }
    });
  };
  tick();
  return async () => { stopping = true; if (timer) clearTimeout(timer); await active; };
}
