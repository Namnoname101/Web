import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { getPrismaClient } from '@personal-schedule/database';
import { config } from './config.js';
import { ApiError } from './lib/errors.js';
import { bumpVersion, withUser } from './lib/transaction.js';
import { eventInput, taskInput, settingsInput, horizonInput, idSchema } from './lib/validation.js';
import { requireUser, publicUser, issueSession, SESSION_COOKIE, cookieOptions } from './modules/auth/session.js';
import { createDemoStudent } from './modules/auth/demo.js';
import { SchedulingService } from './modules/scheduling/scheduling.service.js';
import { getAgendaOverview } from './modules/scheduling/agenda-overview.js';
import { acceptEventChange, checkEventConflicts } from './modules/scheduling/event-changes.js';
import { uedReadiness } from './modules/integrations/ued/adapter.js';
import { proposeAfterCalendarChange } from './modules/scheduling/automatic-proposals.js';

export const router = Router();
const db = () => getPrismaClient();
const mutationLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

function publicIntegrations<T extends { provider: 'UED' | 'OUTLOOK'; cursor: unknown }>(integrations: T[]) {
  return integrations.map(({ cursor, ...integration }) => {
    // Outlook cursor values can contain opaque Graph continuation state. The
    // browser never needs them. UED only exposes the three term-selection
    // fields rendered by the settings page; worker/baseline internals stay on
    // the server as well.
    if (integration.provider !== 'UED' || !cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return integration;
    const value = cursor as Record<string, unknown>;
    return { ...integration, cursor: {
      ...(value.uedTerm !== undefined ? { uedTerm: value.uedTerm } : {}),
      ...(value.uedTermMode !== undefined ? { uedTermMode: value.uedTermMode } : {}),
      ...(value.uedTermChoices !== undefined ? { uedTermChoices: value.uedTermChoices } : {}),
    } };
  });
}

router.get('/auth/config', (_req, res) => res.json({ demoEnabled: config.demoEnabled, microsoftEnabled: !!(config.microsoft.clientId && config.microsoft.clientSecret), uedEnabled: uedReadiness().loginReady }));
router.get('/auth/me', requireUser, (req, res) => res.json({ user: publicUser(req.user!) }));
router.post('/auth/demo', rateLimit({ windowMs: 3_600_000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false }), async (_req, res) => {
  if (!config.demoEnabled) throw new ApiError(404, 'DEMO_DISABLED');
  const user = await createDemoStudent();
  await issueSession(user.id, res);
  res.status(201).json({ user: publicUser(user) });
});
router.post('/auth/logout', async (req, res) => {
  if (req.sessionId) await db().session.deleteMany({ where: { id: req.sessionId } });
  res.clearCookie(SESSION_COOKIE, cookieOptions).json({ loggedOut: true });
});
router.use(requireUser);

router.get('/bootstrap', async (req, res) => {
  const userId = req.user!.id;
  const now = new Date();
  const range = horizonInput.parse({ fromDate: req.query.fromDate || now.toISOString(), toDate: req.query.toDate || new Date(+now + 7 * 86_400_000).toISOString() });
  const time = { startTime: { lt: range.toDate }, endTime: { gt: range.fromDate } };
  await db().suggestion.updateMany({ where: { userId, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
  const [events, blocks, tasks, suggestions, notifications, integrations, academicRecords, agendaOverview] = await Promise.all([
    db().event.findMany({ where: { userId, ...time }, orderBy: { startTime: 'asc' } }),
    db().taskScheduleBlock.findMany({ where: { userId, status: { not: 'CANCELLED' }, ...time }, include: { task: true }, orderBy: { startTime: 'asc' } }),
    db().task.findMany({ where: { userId }, include: { scheduleBlocks: { where: { status: { not: 'CANCELLED' } }, orderBy: { startTime: 'asc' } } }, orderBy: [{ priority: 'asc' }, { deadline: 'asc' }] }),
    Promise.all([
      // Never let accepted history crowd actionable UED occurrences out of the
      // bootstrap response. The separate caps keep the first application load bounded.
      db().suggestion.findMany({ where: { userId, status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 500 }),
      db().suggestion.findMany({ where: { userId, status: { not: 'PENDING' } }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]).then(([pending, history]) => [...pending, ...history]),
    db().notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db().integration.findMany({ where: { userId }, select: { provider: true, status: true, lastSyncAt: true, nextSyncAt: true, lastError: true, cursor: true } }),
    db().academicRecord.findMany({ where: { userId }, orderBy: { syncedAt: 'desc' }, take: 200 }),
    getAgendaOverview(userId, req.user!.timezone, now),
  ]);
  res.json({ user: publicUser(req.user!), events, blocks, tasks, suggestions, notifications,
    integrations: publicIntegrations(integrations), academicRecords, agendaOverview });
});

router.post('/tasks', async (req, res) => {
  const input = taskInput.parse(req.body), userId = req.user!.id;
  if (+input.deadline <= Date.now()) throw new ApiError(400, 'DEADLINE_PASSED');
  const task = await withUser(userId, async tx => {
    const value = await tx.task.create({ data: { ...input, userId } });
    await bumpVersion(tx, userId); return value;
  });
  res.status(201).json(task);
});
router.patch('/tasks/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id), userId = req.user!.id;
  const task = await withUser(userId, async tx => {
    const previous = await tx.task.findFirst({ where: { id, userId }, include: { scheduleBlocks: { where: { status: 'SCHEDULED' } } } });
    if (!previous) throw new ApiError(404, 'NOT_FOUND');
    const input = taskInput.parse({ ...previous, deadline: previous.deadline.toISOString(), ...req.body });
    if (+input.deadline <= Date.now()) throw new ApiError(400, 'DEADLINE_PASSED');
    if (previous.status !== 'PENDING') throw new ApiError(409, 'TASK_NOT_PENDING');
    if (previous.scheduleBlocks.length && (input.durationMinutes !== previous.durationMinutes || +input.deadline !== +previous.deadline || input.isSplittable !== previous.isSplittable || (input.location || null) !== previous.location)) throw new ApiError(409, 'UNSCHEDULE_FIRST');
    const value = await tx.task.update({ where: { id }, data: input });
    await bumpVersion(tx, userId); return value;
  });
  res.json(task);
});
router.patch('/tasks/:id/status', async (req, res) => {
  const id = idSchema.parse(req.params.id), userId = req.user!.id;
  const { status } = z.object({ status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) }).parse(req.body);
  const result = await withUser(userId, async tx => {
    const task = await tx.task.findFirst({ where: { id, userId } });
    if (!task) throw new ApiError(404, 'NOT_FOUND');
    const now = new Date();
    if (status === 'COMPLETED' || status === 'CANCELLED') {
      // Capture one boundary so elapsed, current and future blocks form exact,
      // non-overlapping sets. The elapsed part of a session already in progress
      // remains visible in history; only time from now onward is released.
      await tx.taskScheduleBlock.updateMany({ where: { userId, taskId: id, status: 'SCHEDULED', endTime: { lte: now } }, data: { status: 'COMPLETED' } });
      await tx.taskScheduleBlock.updateMany({ where: { userId, taskId: id, status: 'SCHEDULED', startTime: { lt: now }, endTime: { gt: now } }, data: { status: 'COMPLETED', endTime: now } });
      await tx.taskScheduleBlock.updateMany({ where: { userId, taskId: id, status: 'SCHEDULED', startTime: { gte: now } }, data: { status: 'CANCELLED' } });
    }
    const value = await tx.task.update({ where: { id }, data: { status, completedAt: status === 'COMPLETED' ? now : null, ...(['COMPLETED', 'CANCELLED'].includes(task.status) || ['COMPLETED', 'CANCELLED'].includes(status) ? { isScheduled: false } : {}) } });
    await bumpVersion(tx, userId); return value;
  }); res.json(result);
});
router.post('/tasks/:id/unschedule', async (req, res) => {
  const id = idSchema.parse(req.params.id), userId = req.user!.id;
  const task = await withUser(userId, async tx => {
    if (!await tx.task.findFirst({ where: { id, userId, status: { in: ['PENDING', 'IN_PROGRESS'] } } })) throw new ApiError(404, 'NOT_FOUND');
    await tx.taskScheduleBlock.updateMany({ where: { userId, taskId: id, status: 'SCHEDULED', startTime: { gt: new Date() } }, data: { status: 'CANCELLED' } });
    // Removing future sessions is a calendar action, not a progress change.
    // An in-progress task must remain in progress and can be planned again.
    const value = await tx.task.update({ where: { id }, data: { isScheduled: false } });
    await bumpVersion(tx, userId); return value;
  }); res.json(task);
});

router.post('/events', async (req, res) => {
  const input = eventInput.parse(req.body), userId = req.user!.id;
  res.status(201).json(await withUser(userId, async tx => {
    await checkEventConflicts(tx, userId, input);
    const event = await tx.event.create({ data: { ...input, userId } });
    await bumpVersion(tx, userId); return event;
  }));
});
router.patch('/events/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id), userId = req.user!.id;
  res.json(await withUser(userId, async tx => {
    const previous = await tx.event.findFirst({ where: { id, userId } });
    if (!previous) throw new ApiError(404, 'NOT_FOUND');
    const input = eventInput.parse({ ...previous, startTime: previous.startTime.toISOString(), endTime: previous.endTime.toISOString(), ...req.body });
    if (previous.status !== 'CANCELLED') await checkEventConflicts(tx, userId, input, id);
    const event = await tx.event.update({ where: { id }, data: input });
    await bumpVersion(tx, userId); return event;
  }));
});
router.patch('/events/:id/status', async (req, res) => {
  const id = idSchema.parse(req.params.id), userId = req.user!.id;
  const { status } = z.object({ status: z.enum(['SCHEDULED', 'CANCELLED', 'COMPLETED']) }).parse(req.body);
  const event = await withUser(userId, async tx => {
    const previous = await tx.event.findFirst({ where: { id, userId } });
    if (!previous) throw new ApiError(404, 'NOT_FOUND');
    if (status !== 'CANCELLED') await checkEventConflicts(tx, userId, previous, id);
    const event = await tx.event.update({ where: { id }, data: { status } });
    await bumpVersion(tx, userId); return event;
  });
  if (status === 'CANCELLED') await proposeAfterCalendarChange(userId);
  res.json(event);
});

router.patch('/settings', async (req, res) => {
  const input = settingsInput.parse(req.body), userId = req.user!.id;
  const wall = (time: string) => new Date(`1970-01-01T${time}:00Z`);
  const user = await withUser(userId, async tx => {
    const value = await tx.user.update({ where: { id: userId }, data: { ...input, activeStartTime: wall(input.activeStartTime), activeEndTime: wall(input.activeEndTime), breakStartTime: wall(input.breakStartTime), breakEndTime: wall(input.breakEndTime) } });
    await bumpVersion(tx, userId); return value;
  }); res.json({ user: publicUser(user) });
});

router.post('/scheduling/proposals', mutationLimit, async (req, res) => {
  const range = horizonInput.parse(req.body);
  res.status(201).json(await new SchedulingService().runAutoRescheduler(req.user!.id, range.fromDate, range.toDate));
});
router.post('/suggestions/:id/accept', mutationLimit, async (req, res) => {
  const id = idSchema.parse(req.params.id), userId = req.user!.id;
  const suggestion = await db().suggestion.findFirst({ where: { id, userId } });
  if (!suggestion) throw new ApiError(404, 'NOT_FOUND');
  const result = suggestion.kind === 'TASK_PLAN' ? await new SchedulingService().accept(userId, id) : await acceptEventChange(userId, id);
  if (suggestion.kind === 'EVENT_CHANGE' && !('alreadyAccepted' in result && result.alreadyAccepted)) await proposeAfterCalendarChange(userId);
  res.json(result);
});
router.post('/suggestions/:id/reject', async (req, res) => {
  const id = idSchema.parse(req.params.id), userId = req.user!.id;
  res.json(await withUser(userId, async tx => {
    const current = await tx.suggestion.findFirst({ where: { id, userId } });
    if (!current) throw new ApiError(404, 'NOT_FOUND');
    if (current.status === 'REJECTED') return current;
    if (current.status !== 'PENDING') throw new ApiError(409, 'SUGGESTION_EXPIRED');
    return tx.suggestion.update({ where: { id }, data: { status: 'REJECTED', decidedAt: new Date() } });
  }));
});
router.post('/notifications/read-all', async (req, res) => {
  await db().notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ read: true });
});
router.post('/notifications/:id/read', async (req, res) => {
  const result = await db().notification.updateMany({ where: { id: idSchema.parse(req.params.id), userId: req.user!.id }, data: { readAt: new Date() } });
  if (!result.count) throw new ApiError(404, 'NOT_FOUND');
  res.json({ read: true });
});
router.get('/integrations', async (req, res) => res.json(await db().integration.findMany({ where: { userId: req.user!.id }, select: { provider: true, status: true, lastSyncAt: true, nextSyncAt: true, lastError: true } })));
router.patch('/integrations/ued/term', async (req, res) => {
  const selection = z.union([
    z.object({ mode: z.literal('CURRENT') }).strict(),
    z.object({ academicYear: z.number().int().min(2009).max(new Date().getFullYear() + 1), semester: z.number().int().min(1).max(3) }).strict(),
  ]).parse(req.body);
  const currentMode = 'mode' in selection;
  const term = currentMode ? null : selection;
  res.json(await withUser(req.user!.id, async tx => {
    const integration = await tx.integration.findUnique({ where: { userId_provider: { userId: req.user!.id, provider: 'UED' } } });
    if (!integration || integration.status !== 'CONNECTED') throw new ApiError(409, 'INTEGRATION_NOT_CONNECTED');
    await tx.integration.update({ where: { id: integration.id }, data: { cursor: { ...(integration.cursor as Record<string, never>),
      uedTermMode: currentMode ? 'CURRENT' : 'SELECTED', uedTerm: term }, nextSyncAt: new Date() } });
    return { queued: true, term, mode: currentMode ? 'CURRENT' : 'SELECTED' };
  }));
});
router.post('/integrations/:provider/sync', mutationLimit, async (req, res) => {
  const provider = z.enum(['UED', 'OUTLOOK']).parse(String(req.params.provider).toUpperCase());
  const result = await db().integration.updateMany({ where: { userId: req.user!.id, provider, status: 'CONNECTED' }, data: { nextSyncAt: new Date() } });
  if (!result.count) throw new ApiError(409, 'INTEGRATION_NOT_CONNECTED');
  res.status(202).json({ queued: true });
});
router.delete('/integrations/:provider', async (req, res) => {
  const provider = z.enum(['UED', 'OUTLOOK']).parse(String(req.params.provider).toUpperCase());
  // Serialize disconnect with an integration worker so a late refresh cannot reconnect it.
  res.json(await withUser(req.user!.id, async tx => {
    if (provider === 'OUTLOOK') await tx.oAuthAttempt.deleteMany({ where: { userId: req.user!.id } });
    await tx.integration.updateMany({ where: { userId: req.user!.id, provider }, data: { status: 'DISCONNECTED', encryptedSecret: null, cursor: {}, lastError: null } });
    return { disconnected: true };
  }));
});
