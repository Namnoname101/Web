import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  prisma: {} as any,
  graphGet: vi.fn(),
  requestTokens: vi.fn(),
  tokens: { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 0, accountId: 'graph-account' },
}));
vi.mock('@personal-schedule/database', () => ({ getPrismaClient: () => fixture.prisma, Prisma: {} }));
vi.mock('../../src/lib/transaction.js', () => ({ withUser: (_userId: string, operation: (tx: any) => unknown) => operation(fixture.prisma) }));
vi.mock('../../src/lib/crypto.js', () => ({ decrypt: () => fixture.tokens, encrypt: () => 'rotated-secret', hash: (id: string) => `hash-${id}` }));
vi.mock('../../src/modules/integrations/outlook/oauth.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/modules/integrations/outlook/oauth.js')>(),
  graphGet: fixture.graphGet,
  requestTokens: fixture.requestTokens,
}));

import { initialMailPage, syncOutlook } from '../../src/modules/integrations/outlook/outlook.service.js';
import { ApiError } from '../../src/lib/errors.js';
import { OutlookThrottleError } from '../../src/modules/integrations/outlook/oauth.js';

let current: any;
const seen = new Set<string>();
const message = { id: 'immutable-mail-1', subject: 'Giải tích 1 nghỉ học ngày 14/09/2026', body: { contentType: 'text', content: 'Thông báo nghỉ học.' } };

beforeEach(() => {
  vi.clearAllMocks();
  fixture.graphGet.mockReset();
  fixture.requestTokens.mockReset();
  fixture.tokens = { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: Date.now() + 3_600_000, accountId: 'graph-account' };
  current = { id: 'outlook-1', userId: 'student-1', provider: 'OUTLOOK', status: 'CONNECTED', encryptedSecret: 'old-secret',
    cursor: {}, failures: 0, leaseToken: 'lease-1', user: { id: 'student-1', timezone: 'Asia/Ho_Chi_Minh', scheduleVersion: 4, notificationsEnabled: true } };
  seen.clear();
  fixture.prisma = {
    integration: {
      findUnique: vi.fn(async () => ({ ...current, cursor: { ...current.cursor } })),
      update: vi.fn(async ({ data }) => { Object.assign(current, data); return current; }),
      updateMany: vi.fn(async ({ where, data }) => {
        if (current.status !== where.status || current.encryptedSecret !== where.encryptedSecret || current.leaseToken !== where.leaseToken) return { count: 0 };
        Object.assign(current, data);
        return { count: 1 };
      }),
    },
    user: { findUniqueOrThrow: vi.fn(async () => current.user) },
    event: { findMany: vi.fn(async () => [{ id: 'math-1', title: 'Giải tích 1', startTime: new Date('2026-09-14T01:00:00Z'),
      endTime: new Date('2026-09-14T03:00:00Z'), location: 'A101', updatedAt: new Date('2026-09-01T01:00:00Z') }]) },
    suggestion: { createMany: vi.fn(async ({ data }) => {
      const key = data[0].sourceKey;
      if (seen.has(key)) return { count: 0 };
      seen.add(key);
      return { count: 1 };
    }) },
    notification: { createMany: vi.fn(async () => ({ count: 1 })), upsert: vi.fn(async () => ({})) },
  };
});

describe('Outlook mailbox sync and concurrent disconnect', () => {
  it('scans the whole mailbox and overlaps the previous watermark without rebuilding paging tokens', () => {
    const url = new URL(initialMailPage({ completedThrough: '2026-09-13T10:00:00Z' }, '2026-09-13T11:00:00Z'));
    expect(url.pathname).toBe('/v1.0/me/messages');
    expect(url.searchParams.get('$filter')).toBe('receivedDateTime le 2026-09-13T11:00:00Z and receivedDateTime ge 2026-09-12T10:00:00.000Z');
    expect(url.searchParams.get('$select')).toContain('body');
  });

  it('discards an orphaned paging URL and safely rescans instead of skipping mail', async () => {
    current.cursor = { nextLink: 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=orphaned' };
    fixture.graphGet.mockResolvedValue({ value: [] });
    await syncOutlook(current.id);
    const requested = new URL(fixture.graphGet.mock.calls[0][0]);
    expect(requested.searchParams.get('$skiptoken')).toBeNull();
    expect(requested.searchParams.get('$filter')).toContain('receivedDateTime le');
  });

  it('creates only a pending suggestion and one notification, then deduplicates repeated pages', async () => {
    fixture.graphGet.mockResolvedValue({ value: [message] });
    expect(await syncOutlook(current.id)).toEqual({ processed: 1, proposed: 1, complete: true });
    expect(fixture.prisma.suggestion.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true,
      data: [expect.objectContaining({ kind: 'EVENT_CHANGE', baseVersion: 4, payload: expect.objectContaining({ action: 'CANCEL', eventId: 'math-1' }) })] }));
    expect(await syncOutlook(current.id)).toEqual({ processed: 1, proposed: 0, complete: true });
    expect(fixture.prisma.notification.createMany).toHaveBeenCalledTimes(1);
    expect(current.cursor).toEqual({ completedThrough: expect.any(String) });
  });

  it('saves the next page after bounded work and does not advance the completed watermark', async () => {
    current.cursor = { completedThrough: '2026-09-12T10:00:00Z' };
    let index = 0;
    fixture.graphGet.mockImplementation(async () => ({ value: [], '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/messages?$skiptoken=opaque%2B${++index}` }));
    expect(await syncOutlook(current.id)).toEqual({ processed: 0, proposed: 0, complete: false });
    expect(fixture.graphGet).toHaveBeenCalledTimes(8);
    expect(current.cursor).toEqual({ completedThrough: '2026-09-12T10:00:00.000Z', scanStartedAt: expect.any(String),
      nextLink: 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=opaque%2B8' });
  });

  it('retains committed pages and Retry-After when a later page is throttled', async () => {
    const next = 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=second';
    fixture.graphGet.mockResolvedValueOnce({ value: [message], '@odata.nextLink': next }).mockRejectedValueOnce(new OutlookThrottleError(120_000));
    const before = Date.now();
    await expect(syncOutlook(current.id)).rejects.toThrow('OUTLOOK_THROTTLED');
    expect(current.cursor.nextLink).toBe(next);
    expect(current.cursor.completedThrough).toBeUndefined();
    expect(current.status).toBe('CONNECTED');
    expect(+current.nextSyncAt).toBeGreaterThanOrEqual(before + 120_000);
    expect(fixture.prisma.suggestion.createMany).toHaveBeenCalledTimes(1);
  });

  it('cannot create suggestions or reconnect when disconnected during the Graph request', async () => {
    fixture.graphGet.mockImplementation(async () => {
      current.status = 'DISCONNECTED';
      current.encryptedSecret = null;
      return { value: [message] };
    });
    await expect(syncOutlook(current.id)).rejects.toThrow('INTEGRATION_CHANGED');
    expect(current.status).toBe('DISCONNECTED');
    expect(current.encryptedSecret).toBeNull();
    expect(fixture.prisma.suggestion.createMany).not.toHaveBeenCalled();
    expect(fixture.prisma.integration.update).not.toHaveBeenCalled();
  });

  it('cannot save rotated tokens when disconnected while the token refresh is in flight', async () => {
    fixture.tokens.expiresAt = 0;
    fixture.requestTokens.mockImplementation(async () => {
      current.status = 'DISCONNECTED';
      current.encryptedSecret = null;
      return { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: Date.now() + 3_600_000 };
    });
    await expect(syncOutlook(current.id)).rejects.toThrow('INTEGRATION_CHANGED');
    expect(current.status).toBe('DISCONNECTED');
    expect(current.encryptedSecret).toBeNull();
    expect(fixture.graphGet).not.toHaveBeenCalled();
  });

  it('turns an unreadable stored token into one reconnect notification instead of a hot retry', async () => {
    fixture.tokens = null as any;
    await expect(syncOutlook(current.id)).rejects.toMatchObject({ code: 'OUTLOOK_REAUTH_REQUIRED' });
    expect(current.status).toBe('REAUTH_REQUIRED');
    expect(current.lastError).toBe('OUTLOOK_REAUTH_REQUIRED');
    expect(fixture.prisma.notification.upsert).toHaveBeenCalledOnce();
    expect(fixture.graphGet).not.toHaveBeenCalled();
  });

  it('cannot commit after another worker acquires an expired lease', async () => {
    fixture.graphGet.mockImplementation(async () => {
      current.leaseToken = 'lease-2';
      return { value: [message] };
    });
    await expect(syncOutlook(current.id)).rejects.toThrow('INTEGRATION_CHANGED');
    expect(fixture.prisma.suggestion.createMany).not.toHaveBeenCalled();
    expect(fixture.prisma.integration.update).not.toHaveBeenCalled();
    expect(current.failures).toBe(0);
  });

  it('retries Graph once with the rotated token and commits only while the connection still matches', async () => {
    fixture.graphGet.mockRejectedValueOnce(new ApiError(401, 'OUTLOOK_REAUTH_REQUIRED')).mockResolvedValueOnce({ value: [] });
    fixture.requestTokens.mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: Date.now() + 3_600_000 });
    expect((await syncOutlook(current.id)).complete).toBe(true);
    expect(fixture.graphGet.mock.calls.map(call => call[1])).toEqual(['old-access', 'new-access']);
    expect(current.encryptedSecret).toBe('rotated-secret');
    expect(fixture.requestTokens).toHaveBeenCalledWith({ grant_type: 'refresh_token', refresh_token: 'old-refresh' }, 'old-refresh');
  });
});
