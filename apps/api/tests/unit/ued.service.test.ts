import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findIntegration: vi.fn(), currentIntegration: vi.fn(), createRecord: vi.fn(),
  findRecord: vi.fn(),
  read: vi.fn(), updateIntegration: vi.fn(), updateIntegrations: vi.fn(), findUser: vi.fn(),
  findEvents: vi.fn(), findEvent: vi.fn(), createEvent: vi.fn(), findSuggestion: vi.fn(), findSuggestions: vi.fn(),
  findSuggestionForAccept: vi.fn(), updateSuggestion: vi.fn(),
  updateSuggestions: vi.fn(), createSuggestion: vi.fn(), createNotification: vi.fn(),
  upsertNotification: vi.fn(), decrypt: vi.fn(), bumpVersion: vi.fn(),
}));
vi.mock('@personal-schedule/database', () => ({ getPrismaClient: () => ({ integration: { findUnique: mocks.findIntegration } }) }));
vi.mock('../../src/lib/transaction.js', () => ({ withUser: async (_id: string, operation: (tx: unknown) => unknown) => operation({
  integration: { findUnique: mocks.currentIntegration, update: mocks.updateIntegration, updateMany: mocks.updateIntegrations },
  academicRecord: { findFirst: mocks.findRecord, upsert: mocks.createRecord }, user: { findUniqueOrThrow: mocks.findUser },
  event: { findMany: mocks.findEvents, findUnique: mocks.findEvent, create: mocks.createEvent },
  suggestion: { findUnique: mocks.findSuggestion, findMany: mocks.findSuggestions, findFirst: mocks.findSuggestionForAccept,
    update: mocks.updateSuggestion, updateMany: mocks.updateSuggestions, create: mocks.createSuggestion },
  notification: { create: mocks.createNotification, upsert: mocks.upsertNotification },
}), bumpVersion: mocks.bumpVersion }));
vi.mock('../../src/lib/crypto.js', () => ({ hash: (value: string) => value, encrypt: vi.fn(),
  decrypt: mocks.decrypt }));
vi.mock('../../src/modules/integrations/ued/browser.js', () => ({ readUedPortal: mocks.read }));
vi.mock('../../src/modules/integrations/ued/adapter.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/modules/integrations/ued/adapter.js')>(),
  getUedAdapter: () => ({ pages: [{ key: 'verified', termFilter: 'UED_TIMETABLE' }] }),
}));

import { acceptEventChange } from '../../src/modules/scheduling/event-changes.js';
import { materializeLegacyUedTimetable, syncUed, uedChangeIdentity, uedEventChange } from '../../src/modules/integrations/ued/ued.service.js';

const schedule = { externalId: 'external1', title: 'Class', startTime: '2026-09-14T00:00:00.000Z',
  endTime: '2026-09-14T02:00:00.000Z', location: 'A101', eventType: 'CLASS' as const, cancelled: false };
const event = { ...schedule, id: 'event1', startTime: new Date(schedule.startTime), endTime: new Date(schedule.endTime),
  status: 'SCHEDULED', updatedAt: new Date('2026-09-13T00:00:00Z') };
const portalRecord = { externalId: schedule.externalId, pageKey: 'verified', category: 'SCHEDULE', title: schedule.title,
  term: { academicYear: '2026', semester: '1' }, fields: { location: 'A101' }, schedule };

describe('UED event-change classification', () => {
  it('returns no change for identical records, proposes create/update/cancel explicitly', () => {
    expect(uedEventChange(schedule, event)).toBe(null);
    expect(uedEventChange(schedule)).toMatchObject({ action: 'CREATE', changes: { title: 'Class' } });
    expect(uedEventChange({ ...schedule, location: 'B201' }, event)).toMatchObject({ action: 'UPDATE', eventId: 'event1',
      expectedUpdatedAt: '2026-09-13T00:00:00.000Z', changes: { location: 'B201' } });
    expect(uedEventChange({ ...schedule, cancelled: true }, event)).toMatchObject({ action: 'CANCEL', eventId: 'event1' });
    expect(uedEventChange({ ...schedule, cancelled: true })).toBe(null);
    expect(uedEventChange(schedule, { ...event, status: 'CANCELLED' })).toMatchObject({ action: 'REVIEW' });
  });
  it('keeps proposal identity independent of display-only occurrence snapshots', () => {
    const change = uedEventChange(schedule)!;
    expect(uedChangeIdentity(change)).toEqual({ action: 'CREATE', changes: {
      title: 'Class', startTime: schedule.startTime, endTime: schedule.endTime, location: 'A101', eventType: 'CLASS',
    } });
    expect(uedChangeIdentity({ ...change, occurrence: { title: 'translated display title' }, after: { location: 'display only' } })).toEqual(
      uedChangeIdentity(change));
  });
});

describe('UED disconnect/reconnect race protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decrypt.mockReturnValue({ version: 1, studentId: 'TEST123', storageState: { cookies: [], origins: [] } });
    mocks.findIntegration.mockResolvedValue({ id: 'integration1', userId: 'user1', provider: 'UED', status: 'CONNECTED', encryptedSecret: 'old-secret' });
    mocks.read.mockResolvedValue({ records: [], storageState: { cookies: [], origins: [] } });
    mocks.updateIntegrations.mockResolvedValue({ count: 1 });
    mocks.updateSuggestions.mockResolvedValue({ count: 0 });
    mocks.findRecord.mockResolvedValue(null);
    mocks.findEvents.mockResolvedValue([]);
    mocks.findSuggestion.mockResolvedValue(null);
    mocks.findUser.mockResolvedValue({ id: 'user1', notificationsEnabled: false, scheduleVersion: 4 });
  });
  it.each([
    { status: 'DISCONNECTED', encryptedSecret: null },
    { status: 'CONNECTED', encryptedSecret: 'new-secret' },
  ])('does not persist a completed crawl after state changed: %s', async current => {
    mocks.currentIntegration.mockResolvedValue(current);
    await expect(syncUed('integration1')).rejects.toMatchObject({ code: 'UED_SYNC_SUPERSEDED' });
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.createRecord).not.toHaveBeenCalled();
    expect(mocks.updateIntegration).not.toHaveBeenCalled();
  });
  it.each([
    { cursor: { uedTerm: { academicYear: '2025', semester: '2' } }, expected: undefined },
    { cursor: { uedTermMode: 'CURRENT', uedTerm: { academicYear: '2025', semester: '2' } }, expected: undefined },
    { cursor: { uedTermMode: 'SELECTED', uedTerm: { academicYear: 2025, semester: 2 } }, expected: { academicYear: '2025', semester: '2' } },
  ])('uses current semester unless a historical filter was explicitly selected: $cursor', async ({ cursor, expected }) => {
    mocks.findIntegration.mockResolvedValue({ id: 'integration1', userId: 'user1', provider: 'UED', status: 'CONNECTED', encryptedSecret: 'old-secret', cursor });
    mocks.read.mockRejectedValue(new Error('NETWORK_STOP_FOR_TEST'));
    await expect(syncUed('integration1')).rejects.toThrow('NETWORK_STOP_FOR_TEST');
    expect(mocks.read.mock.calls[0][3]).toEqual(expected);
  });
  it('discards a crawl if the student switches semester mode while it is running', async () => {
    mocks.currentIntegration.mockResolvedValue({ status: 'CONNECTED', encryptedSecret: 'old-secret', cursor: { uedTermMode: 'SELECTED' } });
    await expect(syncUed('integration1')).rejects.toMatchObject({ code: 'UED_SYNC_SUPERSEDED' });
    expect(mocks.createRecord).not.toHaveBeenCalled();
  });
  it('fails closed, requests reauthentication and never preserves unknown secret fields', async () => {
    mocks.decrypt.mockReturnValue({ version: 1, studentId: 'TEST123', storageState: { cookies: [], origins: [] }, password: 'must-not-survive' });
    await expect(syncUed('integration1')).rejects.toMatchObject({ code: 'UED_REAUTH_REQUIRED' });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.updateIntegrations).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REAUTH_REQUIRED', lastError: 'UED_REAUTH_REQUIRED' }),
    }));
  });
  it('maps an unreadable encrypted session to a clear reauthentication state', async () => {
    mocks.decrypt.mockImplementationOnce(() => { throw new Error('authentication tag failed'); });
    await expect(syncUed('integration1')).rejects.toMatchObject({ code: 'UED_REAUTH_REQUIRED' });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.updateIntegrations).toHaveBeenCalledOnce();
  });
});

describe('UED fixed timetable import and change reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decrypt.mockReturnValue({ version: 1, studentId: 'TEST123', storageState: { cookies: [], origins: [] } });
    mocks.findIntegration.mockResolvedValue({ id: 'integration1', userId: 'user1', provider: 'UED', status: 'CONNECTED', encryptedSecret: 'old-secret' });
    mocks.currentIntegration.mockResolvedValue({ id: 'integration1', status: 'CONNECTED', encryptedSecret: 'old-secret' });
    mocks.read.mockResolvedValue({ records: [portalRecord], storageState: { cookies: [], origins: [] } });
    mocks.findEvents.mockResolvedValue([]);
    mocks.createEvent.mockResolvedValue({ ...event, source: 'SCHOOL_PORTAL', externalId: schedule.externalId });
    mocks.findSuggestion.mockResolvedValue(null);
    mocks.updateSuggestions.mockResolvedValue({ count: 0 });
    mocks.findRecord.mockResolvedValue(null);
    mocks.findUser.mockResolvedValue({ id: 'user1', studentId: 'TEST123', notificationsEnabled: false, scheduleVersion: 4 });
  });

  it('imports an unseen UED class as a fixed calendar Event and retires legacy proposals', async () => {
    mocks.findUser.mockResolvedValue({ id: 'user1', studentId: 'TEST123', notificationsEnabled: true, scheduleVersion: 4 });
    await expect(syncUed('integration1')).resolves.toEqual({ records: 1, imported: 1, proposals: 0 });

    expect(mocks.createEvent).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: 'user1', title: 'Class', startTime: new Date(schedule.startTime), endTime: new Date(schedule.endTime),
      location: 'A101', eventType: 'CLASS', status: 'SCHEDULED', source: 'SCHOOL_PORTAL', externalId: schedule.externalId,
      sourceMetadata: expect.objectContaining({ provider: 'UED', fixed: true, pageKey: 'verified',
        term: { academicYear: '2026', semester: '1' } }),
    }) });
    expect(mocks.updateSuggestions).toHaveBeenCalledWith({ where: {
      userId: 'user1', kind: 'EVENT_CHANGE', status: 'PENDING',
      AND: [
        { payload: { path: ['externalId'], equals: schedule.externalId } },
        { payload: { path: ['evidence', 'source'], equals: 'UED' } },
      ],
    }, data: { status: 'EXPIRED' } });
    expect(mocks.createSuggestion).not.toHaveBeenCalled();
    expect(mocks.bumpVersion).toHaveBeenCalledOnce();
    expect(mocks.updateIntegration).toHaveBeenCalledWith({ where: { id: 'integration1' }, data: expect.objectContaining({
      cursor: expect.objectContaining({ recordCount: 1, importedCount: 1, proposalCount: 0,
        uedTimetableBaselineTerms: ['2026:1'] }),
    }) });
    expect(mocks.createNotification).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: 'user1', titleVi: 'Đã thêm lịch học cố định từ UED',
    }) });
  });

  it('offers an unseen class as a CREATE proposal after that term has a baseline', async () => {
    const cursor = { uedTimetableBaselineTerms: ['2026:1'] };
    mocks.findIntegration.mockResolvedValue({ id: 'integration1', userId: 'user1', provider: 'UED', status: 'CONNECTED',
      encryptedSecret: 'old-secret', cursor });
    mocks.currentIntegration.mockResolvedValue({ id: 'integration1', status: 'CONNECTED', encryptedSecret: 'old-secret', cursor });

    await expect(syncUed('integration1')).resolves.toEqual({ records: 1, imported: 0, proposals: 1 });

    expect(mocks.createEvent).not.toHaveBeenCalled();
    expect(mocks.createSuggestion).toHaveBeenCalledWith({ data: expect.objectContaining({
      kind: 'EVENT_CHANGE', payload: expect.objectContaining({ action: 'CREATE', externalId: schedule.externalId,
        term: { academicYear: '2026', semester: '1' }, evidence: expect.objectContaining({ source: 'UED' }) }),
    }) });
    expect(mocks.bumpVersion).not.toHaveBeenCalled();
  });

  it('infers an already-synced legacy term from its successful cursor before adding the marker', async () => {
    const cursor = { uedTerm: { academicYear: '2026', semester: '1' }, mappedPages: ['verified'] };
    const previousSync = new Date('2026-09-13T00:00:00Z');
    mocks.findIntegration.mockResolvedValue({ id: 'integration1', userId: 'user1', provider: 'UED', status: 'CONNECTED',
      encryptedSecret: 'old-secret', cursor, lastSyncAt: previousSync });
    mocks.currentIntegration.mockResolvedValue({ id: 'integration1', status: 'CONNECTED', encryptedSecret: 'old-secret',
      cursor, lastSyncAt: previousSync });

    await expect(syncUed('integration1')).resolves.toEqual({ records: 1, imported: 0, proposals: 1 });

    expect(mocks.findRecord).not.toHaveBeenCalled();
    expect(mocks.createEvent).not.toHaveBeenCalled();
    expect(mocks.updateIntegration).toHaveBeenCalledWith({ where: { id: 'integration1' }, data: expect.objectContaining({
      cursor: expect.objectContaining({ uedTimetableBaselineTerms: ['2026:1'] }),
    }) });
  });

  it('infers an older legacy term from stored UED academic evidence', async () => {
    const cursor = { uedTimetableBaselineTerms: ['2025:2'] };
    mocks.findIntegration.mockResolvedValue({ id: 'integration1', userId: 'user1', provider: 'UED', status: 'CONNECTED',
      encryptedSecret: 'old-secret', cursor });
    mocks.currentIntegration.mockResolvedValue({ id: 'integration1', status: 'CONNECTED', encryptedSecret: 'old-secret', cursor });
    mocks.findRecord.mockResolvedValue({ id: 'stored-record' });

    await expect(syncUed('integration1')).resolves.toEqual({ records: 1, imported: 0, proposals: 1 });

    expect(mocks.findRecord).toHaveBeenCalledWith({ where: expect.objectContaining({ userId: 'user1', category: 'SCHEDULE' }),
      select: { id: true } });
    expect(mocks.createEvent).not.toHaveBeenCalled();
    expect(mocks.updateIntegration).toHaveBeenCalledWith({ where: { id: 'integration1' }, data: expect.objectContaining({
      cursor: expect.objectContaining({ uedTimetableBaselineTerms: ['2025:2', '2026:1'] }),
    }) });
  });

  it('fails closed before crawling when the persisted baseline marker is malformed', async () => {
    mocks.findIntegration.mockResolvedValue({ id: 'integration1', userId: 'user1', provider: 'UED', status: 'CONNECTED',
      encryptedSecret: 'old-secret', cursor: { uedTimetableBaselineTerms: ['not-a-term'] } });

    await expect(syncUed('integration1')).rejects.toMatchObject({ code: 'UED_BASELINE_CURSOR_INVALID' });

    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.createEvent).not.toHaveBeenCalled();
    expect(mocks.createSuggestion).not.toHaveBeenCalled();
  });

  it('keeps a later UED change as a pending confirmation proposal', async () => {
    mocks.findEvents.mockResolvedValue([{ ...event, location: 'B201' }]);
    mocks.findSuggestion.mockResolvedValue({ id: 'suggestion1', status: 'PENDING', expiresAt: new Date(Date.now() + 60_000) });

    await expect(syncUed('integration1')).resolves.toEqual({ records: 1, imported: 0, proposals: 0 });

    expect(mocks.createEvent).not.toHaveBeenCalled();
    expect(mocks.createSuggestion).not.toHaveBeenCalled();
    expect(mocks.updateSuggestion).toHaveBeenCalledWith({ where: { id: 'suggestion1' }, data: expect.objectContaining({
      baseVersion: 4,
      payload: expect.objectContaining({ externalId: schedule.externalId,
        term: { academicYear: '2026', semester: '1' }, evidence: expect.objectContaining({ source: 'UED' }) }),
    }) });
  });

  it('expires every pending UED proposal for an occurrence once the accepted Event matches the portal', async () => {
    mocks.findEvents.mockResolvedValue([event]);

    await expect(syncUed('integration1')).resolves.toEqual({ records: 1, imported: 0, proposals: 0 });

    expect(mocks.updateSuggestions).toHaveBeenCalledWith({ where: {
      userId: 'user1', kind: 'EVENT_CHANGE', status: 'PENDING',
      AND: [
        { payload: { path: ['externalId'], equals: schedule.externalId } },
        { payload: { path: ['evidence', 'source'], equals: 'UED' } },
      ],
    }, data: { status: 'EXPIRED' } });
    expect(mocks.findSuggestion).not.toHaveBeenCalled();
    expect(mocks.createSuggestion).not.toHaveBeenCalled();
  });

  it('does not import a cancelled occurrence that has never existed in the calendar', async () => {
    mocks.read.mockResolvedValue({ records: [{ ...portalRecord, schedule: { ...schedule, cancelled: true } }],
      storageState: { cookies: [], origins: [] } });

    await expect(syncUed('integration1')).resolves.toEqual({ records: 1, imported: 0, proposals: 0 });

    expect(mocks.createEvent).not.toHaveBeenCalled();
    expect(mocks.createSuggestion).not.toHaveBeenCalled();
    expect(mocks.bumpVersion).not.toHaveBeenCalled();
  });

  it('rejects an expired superseded proposal at acceptance time', async () => {
    mocks.findSuggestionForAccept.mockResolvedValue({ id: 'stale', status: 'EXPIRED', kind: 'EVENT_CHANGE',
      expiresAt: new Date(Date.now() + 60_000), payload: {} });

    await expect(acceptEventChange('user1', 'stale')).rejects.toMatchObject({ code: 'SUGGESTION_EXPIRED' });
    expect(mocks.updateSuggestion).not.toHaveBeenCalled();
  });
});

describe('legacy UED fixed-timetable materialization', () => {
  const legacySuggestion = {
    id: 'suggestion1', createdAt: new Date('2026-09-13T00:00:00Z'), payload: {
      action: 'CREATE', externalId: schedule.externalId,
      changes: { title: schedule.title, startTime: schedule.startTime, endTime: schedule.endTime,
        location: schedule.location, eventType: schedule.eventType },
      term: portalRecord.term,
      evidence: { source: 'UED', receivedAt: '2026-09-13T00:00:00.000Z' },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findSuggestions.mockResolvedValue([legacySuggestion]);
    mocks.findEvent.mockResolvedValue(null);
    mocks.findUser.mockResolvedValue({ id: 'user1', notificationsEnabled: true });
    mocks.createEvent.mockResolvedValue(event);
  });

  it('validates, imports and retires a verified legacy CREATE atomically', async () => {
    await expect(materializeLegacyUedTimetable('user1')).resolves.toEqual({ candidates: 1, imported: 1, retired: 1 });

    expect(mocks.createEvent).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: 'user1', source: 'SCHOOL_PORTAL', status: 'SCHEDULED', externalId: schedule.externalId,
      sourceMetadata: expect.objectContaining({ provider: 'UED', fixed: true, migratedFromSuggestion: 'suggestion1',
        term: portalRecord.term }),
    }) });
    expect(mocks.updateSuggestion).toHaveBeenCalledWith({ where: { id: 'suggestion1' }, data: { status: 'EXPIRED' } });
    expect(mocks.bumpVersion).toHaveBeenCalledOnce();
    expect(mocks.createNotification).toHaveBeenCalledOnce();
  });

  it('fails closed and leaves an invalid legacy payload untouched', async () => {
    mocks.findSuggestions.mockResolvedValue([{ ...legacySuggestion,
      payload: { ...legacySuggestion.payload, changes: { ...legacySuggestion.payload.changes, endTime: schedule.startTime } } }]);

    await expect(materializeLegacyUedTimetable('user1')).rejects.toMatchObject({ code: 'UED_LEGACY_PROPOSAL_INVALID' });

    expect(mocks.createEvent).not.toHaveBeenCalled();
    expect(mocks.updateSuggestion).not.toHaveBeenCalled();
    expect(mocks.bumpVersion).not.toHaveBeenCalled();
  });
});
