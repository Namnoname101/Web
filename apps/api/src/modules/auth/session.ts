import type { RequestHandler, Response, Request } from 'express';
import { getPrismaClient, type User } from '@personal-schedule/database';
import { config } from '../../config.js';
import { hash, token } from '../../lib/crypto.js';
import { ApiError } from '../../lib/errors.js';
import { clock } from '../scheduling/planner.js';

declare global { namespace Express { interface Request { user?: User; sessionId?: string } } }
export const SESSION_COOKIE = 'ued_session';
export function cookie(req: Request, name: string): string | undefined {
  const value = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);
  try { return value ? decodeURIComponent(value) : undefined; } catch { return undefined; }
}
export const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: config.production, path: '/' };
export async function issueSession(userId: string, response: Response) {
  const value = token();
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  await getPrismaClient().session.create({ data: { userId, tokenHash: hash(value), expiresAt } });
  response.cookie(SESSION_COOKIE, value, { ...cookieOptions, expires: expiresAt });
}
export const attachSession: RequestHandler = async (req, _res, next) => {
  const value = cookie(req, SESSION_COOKIE);
  if (value) {
    const session = await getPrismaClient().session.findUnique({ where: { tokenHash: hash(value) }, include: { user: true } });
    if (session && +session.expiresAt > Date.now()) { req.user = session.user; req.sessionId = session.id; }
    else if (session) await getPrismaClient().session.deleteMany({ where: { id: session.id, expiresAt: { lte: new Date() } } });
  }
  next();
};
export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED');
  next();
};
export function publicUser(user: User) {
  return { id: user.id, email: user.email, name: user.name, studentId: user.studentId, locale: user.locale,
    timezone: user.timezone, activeStartTime: clock(user.activeStartTime), activeEndTime: clock(user.activeEndTime),
    breakStartTime: clock(user.breakStartTime), breakEndTime: clock(user.breakEndTime),
    minBlockMinutes: user.minBlockMinutes, travelMinutes: user.travelMinutes, studyLocation: user.studyLocation,
    notificationsEnabled: user.notificationsEnabled, isDemo: user.isDemo };
}
export const protectMutations: RequestHandler = (req, _res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (req.headers.origin !== config.webOrigin) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED');
    if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED');
  }
  next();
};
