import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  execute: vi.fn(),
  deleteSessions: vi.fn(),
  deleteAttempts: vi.fn(),
}));

vi.mock('@personal-schedule/database', () => ({
  getPrismaClient: () => ({
    $executeRaw: fixture.execute,
    session: { deleteMany: fixture.deleteSessions },
    oAuthAttempt: { deleteMany: fixture.deleteAttempts },
  }),
}));
vi.mock('../../src/modules/integrations/outlook/outlook.service.js', () => ({ syncOutlook: vi.fn() }));
vi.mock('../../src/modules/integrations/ued/ued.service.js', () => ({ syncUed: vi.fn() }));

import { cleanupExpiredAuthentication, createDeadlineReminders, workerErrorSummary } from '../../src/jobs/worker-loop.js';

describe('worker maintenance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('continues reminder insertion beyond a full first batch and filters already-created rows in SQL', async () => {
    fixture.execute.mockResolvedValueOnce(500).mockResolvedValueOnce(7);

    await expect(createDeadlineReminders()).resolves.toBe(507);

    expect(fixture.execute).toHaveBeenCalledTimes(2);
    const sql = String(fixture.execute.mock.calls[0][0]);
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('notifications_enabled');
  });

  it('deletes expired sessions and OAuth attempts with one shared cutoff', async () => {
    fixture.deleteSessions.mockResolvedValue({ count: 3 });
    fixture.deleteAttempts.mockResolvedValue({ count: 2 });
    const cutoff = new Date('2030-09-14T00:00:00.000Z');

    await expect(cleanupExpiredAuthentication(cutoff)).resolves.toEqual({ sessions: 3, oauthAttempts: 2 });

    expect(fixture.deleteSessions).toHaveBeenCalledWith({ where: { expiresAt: { lte: cutoff } } });
    expect(fixture.deleteAttempts).toHaveBeenCalledWith({ where: { expiresAt: { lte: cutoff } } });
  });

  it('logs only a bounded diagnostic code and never an exception message', () => {
    const error = Object.assign(new Error('query and student data must stay private'), { code: 'P2010' });
    expect(workerErrorSummary(error)).toEqual({ name: 'Error', code: 'P2010' });
    expect(JSON.stringify(workerErrorSummary(error))).not.toContain('student data');
    expect(workerErrorSummary({ code: 'unsafe code with spaces', token: 'secret' }))
      .toEqual({ name: 'object', code: 'UNEXPECTED_ERROR' });
  });
});
