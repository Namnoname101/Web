import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { router } from './routes.js';
import { attachSession, protectMutations } from './modules/auth/session.js';
import { ApiError, errorHandler } from './lib/errors.js';
import { getPrismaClient } from '@personal-schedule/database';
import { outlookRouter } from './modules/integrations/outlook/outlook.router.js';
import { uedRouter } from './modules/integrations/ued/ued.routes.js';
import { syncUed } from './modules/integrations/ued/ued.service.js';

import cookieParser from 'cookie-parser';

export const app = express();
const readinessLimit = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'READINESS_RATE_LIMIT' } } });
export const READINESS_SUCCESS_CACHE_MS = 2_000;
export const READINESS_FAILURE_CACHE_MS = 5_000;
export const READINESS_TIMEOUT_MS = 2_000;

interface ReadinessAttempt { probe: Promise<void>; result: Promise<void> }

/** Coalesces readiness traffic, caches both outcomes and bounds every HTTP
 * wait. A timed-out database probe remains the sole in-flight probe until it
 * actually settles, preventing a hung pool from accumulating more queries. */
export function createReadinessCheck(
  probe: () => Promise<unknown>,
  options: { successCacheMs?: number; failureCacheMs?: number; timeoutMs?: number } = {},
): () => Promise<void> {
  const successCacheMs = options.successCacheMs ?? READINESS_SUCCESS_CACHE_MS;
  const failureCacheMs = options.failureCacheMs ?? READINESS_FAILURE_CACHE_MS;
  const timeoutMs = options.timeoutMs ?? READINESS_TIMEOUT_MS;
  let successValidUntil = 0;
  let failureValidUntil = 0;
  let inFlight: ReadinessAttempt | undefined;

  return () => {
    const now = Date.now();
    if (now < successValidUntil) return Promise.resolve();
    if (now < failureValidUntil) return Promise.reject(new ApiError(503, 'DATABASE_NOT_READY'));
    if (inFlight) return inFlight.result;

    const probePromise = Promise.resolve().then(probe).then(() => undefined);
    let timer: ReturnType<typeof setTimeout>;
    const bounded = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new ApiError(503, 'DATABASE_NOT_READY')), timeoutMs);
      timer.unref();
      probePromise.then(resolve, reject).finally(() => clearTimeout(timer));
    });
    const attempt: ReadinessAttempt = {
      probe: probePromise,
      result: bounded.then(() => {
        successValidUntil = Date.now() + successCacheMs;
      }, () => {
        failureValidUntil = Date.now() + failureCacheMs;
        throw new ApiError(503, 'DATABASE_NOT_READY');
      }),
    };
    inFlight = attempt;
    // Keep a timed-out attempt installed until the real query settles. Its
    // already-bounded result rejects immediately for later callers.
    void probePromise.then(() => {
      successValidUntil = Date.now() + successCacheMs;
      failureValidUntil = 0;
      if (inFlight === attempt) inFlight = undefined;
    }, () => {
      failureValidUntil = Date.now() + failureCacheMs;
      if (inFlight === attempt) inFlight = undefined;
    });
    return attempt.result;
  };
}

const checkDatabaseReadiness = createReadinessCheck(
  () => getPrismaClient().$queryRaw`SELECT 1`,
);

app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 0));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", config.webOrigin],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(cookieParser());
app.use(
  cors({
    origin: config.webOrigin,
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/v1/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});
app.get('/api/v1/ready', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
}, readinessLimit, async (_req, res) => {
  await checkDatabaseReadiness();
  res.json({ status: 'ready' });
});
app.get('/api/v1/debug-status', async (_req, res) => {
  const db = getPrismaClient();
  const integrations = await db.integration.findMany({
    select: { id: true, provider: true, status: true, lastSyncAt: true, nextSyncAt: true, failures: true, lastError: true, lockedUntil: true, cursor: true }
  });
  const events = await db.event.count();
  const records = await db.academicRecord.count();
  const users = await db.user.findMany({ select: { id: true, studentId: true, name: true } });
  res.json({ integrations, events, records, users });
});
app.post('/api/v1/debug-sync', async (req, res) => {
  const db = getPrismaClient();
  const integration = await db.integration.findFirst({ where: { provider: 'UED' } });
  if (!integration) return res.json({ error: 'No UED integration found' });
  const requestedTerm = req.body?.academicYear && req.body?.semester
    ? { academicYear: String(req.body.academicYear), semester: String(req.body.semester) }
    : undefined;
  await db.integration.update({
    where: { id: integration.id },
    data: {
      cursor: requestedTerm ? { uedTermMode: 'SELECTED', uedTerm: requestedTerm } : { uedTermMode: 'CURRENT', uedTerm: null },
      lastError: null,
      failures: 0,
      status: 'CONNECTED',
      lockedUntil: null
    }
  });
  try {
    const result = await syncUed(integration.id, requestedTerm);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message, code: err?.code, stack: err?.stack });
  }
});
// API responses can contain identities, timetable, tasks and academic records.
// They must not be retained by a shared browser cache or an intermediary.
app.use('/api/v1', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/api/v1', rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/v1', protectMutations, attachSession);
app.use('/api/v1', outlookRouter, uedRouter);
app.use('/api/v1', router);
app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND' } }));
const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('/{*path}', (_req, res) => res.sendFile(`${webDist}/index.html`));
}
app.use(errorHandler);
