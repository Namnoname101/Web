import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../../../config.js';
import { cookie, cookieOptions, issueSession, publicUser } from '../../auth/session.js';
import { getUedAdapter, uedReadiness } from './adapter.js';
import { closeChallenge, startUedLogin, submitUedLogin } from './browser.js';
import { connectVerifiedUed } from './ued.service.js';

export const uedRouter = Router();
const CHALLENGE_COOKIE = 'ued_challenge';
const challengeCookieOptions = { ...cookieOptions, path: '/api/v1/auth/ued', maxAge: 10 * 60_000 };
const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'UED_LOGIN_RATE_LIMIT' } } });
// A started challenge owns a real Chromium context for up to ten minutes.
// Bound starts separately from CAPTCHA submissions so one client cannot hold
// every browser slot with a handful of abandoned challenges.
const challengeStartLimit = rateLimit({ windowMs: 10 * 60_000, limit: 3, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'UED_CHALLENGE_RATE_LIMIT' } } });
const submission = z.object({ challengeId: z.string().min(32).max(100),
  studentId: z.string().trim().regex(/^[a-zA-Z0-9._-]{3,64}$/),
  password: z.string().min(1).max(256), captcha: z.string().trim().min(1).max(128).optional() }).strict();

uedRouter.get('/integrations/ued/readiness', (_req, res) => res.json(uedReadiness()));
uedRouter.use('/auth/ued', loginLimit, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
uedRouter.post('/auth/ued/start', challengeStartLimit, async (req, res) => {
  z.object({}).strict().parse(req.body);
  await closeChallenge(cookie(req, CHALLENGE_COOKIE));
  const { browserToken, ...result } = await startUedLogin(getUedAdapter(), req.user?.id);
  res.cookie(CHALLENGE_COOKIE, browserToken, challengeCookieOptions).json(result);
});
uedRouter.post('/auth/ued/submit', async (req, res) => {
  const input = submission.parse(req.body);
  const result = await submitUedLogin(cookie(req, CHALLENGE_COOKIE), input, req.user?.id);
  if (result.status !== 'VERIFIED') { res.json(result); return; }
  res.clearCookie(CHALLENGE_COOKIE, { path: challengeCookieOptions.path, secure: config.production });
  const user = await connectVerifiedUed(result.identity, result.storageState, req.user?.id);
  await issueSession(user.id, res);
  res.json({ status: 'CONNECTED', user: publicUser(user) });
});
uedRouter.delete('/auth/ued/challenge', async (req, res) => {
  await closeChallenge(cookie(req, CHALLENGE_COOKIE));
  res.clearCookie(CHALLENGE_COOKIE, { path: challengeCookieOptions.path, secure: config.production }).status(204).end();
});
