import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ prisma: {} as any, requestTokens: vi.fn(), graphGet: vi.fn(), issueSession: vi.fn() }));
vi.mock('@personal-schedule/database', () => ({ getPrismaClient: () => fixture.prisma, Prisma: { TransactionIsolationLevel: { ReadCommitted: 'ReadCommitted' } } }));
vi.mock('../../src/lib/crypto.js', () => ({ token: () => 'c'.repeat(43), hash: (value: string) => `hash:${value}`,
  encrypt: () => 'encrypted', decrypt: () => ({ verifier: 'verifier' }) }));
vi.mock('../../src/lib/transaction.js', () => ({ lockUser: vi.fn() }));
vi.mock('../../src/modules/auth/session.js', () => ({ cookie: (req: any) => req.headers.cookie, cookieOptions: { path: '/' },
  issueSession: fixture.issueSession, requireUser: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock('../../src/modules/integrations/outlook/oauth.js', () => ({
  requestTokens: fixture.requestTokens, graphGet: fixture.graphGet, schoolEmail: () => 'student@ued.udn.vn',
  authorizationUrl: () => 'https://login.microsoftonline.com/authorize', pkcePair: () => ({ verifier: 'v', challenge: 'c' }),
}));

import { outlookRouter } from '../../src/modules/integrations/outlook/outlook.router.js';

const state = 'a'.repeat(43);
const browser = 'b'.repeat(43);
let attempt: any;
let server: Server;
let origin: string;
let currentUserId = 'student-1';

beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => { req.user = { id: currentUserId } as any; next(); });
  app.use(outlookRouter);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local test server');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

beforeEach(() => {
  vi.clearAllMocks();
  fixture.graphGet.mockReset();
  currentUserId = 'student-1';
  attempt = { stateHash: `hash:${state}`, browserHash: `hash:${browser}`, userId: 'student-1', encryptedSecret: 'encrypted-verifier', expiresAt: new Date(Date.now() + 600_000) };
  const user = { id: 'student-1', email: 'student@ued.udn.vn', microsoftId: 'graph-id', isDemo: false };
  fixture.prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async operation => operation(fixture.prisma)),
    oAuthAttempt: {
      findUnique: vi.fn(async () => attempt ? { ...attempt } : null),
      updateMany: vi.fn(async ({ where, data }) => {
        if (!attempt || attempt.browserHash !== where.browserHash || +attempt.expiresAt <= Date.now()) return { count: 0 };
        Object.assign(attempt, data); return { count: 1 };
      }),
      deleteMany: vi.fn(async ({ where }) => {
        if (!attempt || attempt.stateHash !== where.stateHash || attempt.browserHash !== where.browserHash) return { count: 0 };
        attempt = null; return { count: 1 };
      }),
    },
    user: { findUnique: vi.fn(async () => user), update: vi.fn(async ({ data }) => ({ ...user, ...data })) },
    integration: { upsert: vi.fn() },
  };
  fixture.requestTokens.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000 });
  fixture.graphGet.mockResolvedValue({ id: 'graph-id', mail: user.email, displayName: 'Student' });
});

function callback() {
  return fetch(`${origin}/auth/microsoft/callback?state=${state}&code=code`, { headers: { Cookie: browser }, redirect: 'manual' });
}

describe('Microsoft callback intent lifetime', () => {
  it('claims once, consumes inside the user transaction, and issues the connected session', async () => {
    const response = await callback();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('outlook=connected');
    expect(fixture.prisma.oAuthAttempt.updateMany).toHaveBeenCalledOnce();
    expect(fixture.prisma.integration.upsert).toHaveBeenCalledOnce();
    expect(fixture.prisma.user.update).toHaveBeenCalledWith({ where: { id: 'student-1' },
      data: { microsoftId: 'graph-id', email: 'student@ued.udn.vn' } });
    expect(fixture.issueSession).toHaveBeenCalledOnce();
    expect(attempt).toBeNull();
    expect((await callback()).headers.get('location')).toContain('OAUTH_STATE_INVALID');
    expect(fixture.requestTokens).toHaveBeenCalledOnce();
  });

  it('does not reconnect when disconnect removed the claimed intent during Graph HTTP', async () => {
    fixture.graphGet.mockImplementation(async () => {
      // Mirrors generic disconnect removing pending attempts under the user lock.
      attempt = null;
      return { id: 'graph-id', mail: 'student@ued.udn.vn' };
    });
    const response = await callback();
    expect(response.headers.get('location')).toContain('OAUTH_ATTEMPT_CANCELLED');
    expect(fixture.prisma.integration.upsert).not.toHaveBeenCalled();
    expect(fixture.prisma.user.update).not.toHaveBeenCalled();
    expect(fixture.issueSession).not.toHaveBeenCalled();
  });

  it('does not overwrite an email address already owned by another account', async () => {
    fixture.prisma.user.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) => (
      'email' in where ? { id: 'another-student' }
        : { id: 'student-1', email: 'placeholder@students.ued.invalid', microsoftId: 'graph-id', isDemo: false }
    ));
    const response = await callback();
    expect(response.headers.get('location')).toContain('MICROSOFT_EMAIL_ALREADY_LINKED');
    expect(fixture.prisma.user.update).not.toHaveBeenCalled();
    expect(fixture.prisma.integration.upsert).not.toHaveBeenCalled();
    expect(fixture.issueSession).not.toHaveBeenCalled();
  });

  it('rejects a link callback after the student session changes', async () => {
    currentUserId = 'different-student';
    expect((await callback()).headers.get('location')).toContain('OAUTH_SESSION_CHANGED');
    expect(fixture.requestTokens).not.toHaveBeenCalled();
    expect(fixture.prisma.integration.upsert).not.toHaveBeenCalled();
  });

  it('rejects expired or previously claimed state before exchanging tokens', async () => {
    attempt.expiresAt = new Date(Date.now() - 1);
    expect((await callback()).headers.get('location')).toContain('OAUTH_STATE_INVALID');
    attempt.expiresAt = new Date(Date.now() + 60_000);
    attempt.browserHash = 'already-claimed';
    expect((await callback()).headers.get('location')).toContain('OAUTH_STATE_INVALID');
    expect(fixture.requestTokens).not.toHaveBeenCalled();
  });
});
