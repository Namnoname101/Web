import { getPrismaClient, type Prisma } from '@personal-schedule/database';
import { decrypt, encrypt, hash } from '../../../lib/crypto.js';
import { ApiError } from '../../../lib/errors.js';
import { bumpVersion, withUser } from '../../../lib/transaction.js';
import { eventInput } from '../../../lib/validation.js';
import { getUedAdapter, uedTermSchema, type UedRecord, type UedSchedule, type UedTerm } from './adapter.js';
import { readUedPortal, type UedStorageState } from './browser.js';
import { expandTimetable } from './timetable.js';

interface UedSecret { version: 1; studentId: string; storageState: UedStorageState }
interface ExistingEvent {
  id: string; title: string; startTime: Date; endTime: Date; location: string | null;
  eventType: string; status: string; updatedAt: Date;
}

const UED_TIMETABLE_BASELINE_CURSOR_KEY = 'uedTimetableBaselineTerms';
const MAX_UED_BASELINE_TERMS = 64;

function uedTermKey(term: UedTerm): string {
  return `${term.academicYear}:${term.semester}`;
}

/** A malformed marker must never make an already-synced term look new: that
 * would silently import later portal changes. Older cursors legitimately have
 * no marker and are handled by the legacy evidence checks in syncUed. */
function readUedBaselineTerms(cursor: Prisma.JsonObject): Set<string> {
  const value = cursor[UED_TIMETABLE_BASELINE_CURSOR_KEY];
  if (value === undefined) return new Set();
  if (!Array.isArray(value) || value.length > MAX_UED_BASELINE_TERMS
    || value.some(item => typeof item !== 'string' || !/^\d{4}:[1-3]$/.test(item))) {
    throw new ApiError(409, 'UED_BASELINE_CURSOR_INVALID');
  }
  return new Set(value as string[]);
}

function logUnexpectedUed(stage: 'read' | 'persist', error: unknown) {
  if (error instanceof ApiError) return;
  const message = error instanceof Error ? error.message : String(error);
  // Operational clues only: redact URLs, long identifiers and control chars;
  // never include portal content, request bodies, cookies or stack traces.
  const safeMessage = message.replace(/https?:\/\/\S+/gi, '[url]').replace(/[A-Za-z0-9_-]{24,}/g, '[identifier]')
    .replace(/\d{4,}/g, '[number]').replace(/[\r\n\t]+/g, ' ').slice(0, 240);
  console.warn('Unexpected UED sync failure', { stage, name: error instanceof Error ? error.name : typeof error, message: safeMessage });
}

function parseUedSecret(value: unknown): UedSecret {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(409, 'UED_REAUTH_REQUIRED');
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).sort().join(',') !== 'storageState,studentId,version' || candidate.version !== 1
    || typeof candidate.studentId !== 'string' || !/^[A-Za-z0-9._-]{3,64}$/.test(candidate.studentId)) {
    throw new ApiError(409, 'UED_REAUTH_REQUIRED');
  }
  const storage = candidate.storageState;
  if (!storage || typeof storage !== 'object' || Array.isArray(storage)) throw new ApiError(409, 'UED_REAUTH_REQUIRED');
  const state = storage as Record<string, unknown>;
  if (Object.keys(state).some(key => key !== 'cookies' && key !== 'origins') || !Array.isArray(state.cookies)
    || !Array.isArray(state.origins) || [...state.cookies, ...state.origins].some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new ApiError(409, 'UED_REAUTH_REQUIRED');
  }
  // Reconstruct the exact envelope so deprecated or injected top-level fields
  // can never survive decrypt -> sync -> encrypt cycles.
  return { version: 1, studentId: candidate.studentId,
    storageState: { cookies: structuredClone(state.cookies), origins: structuredClone(state.origins) } as UedStorageState };
}

async function markUedReauth(input: { id: string; userId: string; leaseToken: string | null }, initialSecret: string, code: string) {
  await withUser(input.userId, async tx => {
    const changed = await tx.integration.updateMany({ where: { id: input.id, status: 'CONNECTED', encryptedSecret: initialSecret, leaseToken: input.leaseToken },
      data: { status: 'REAUTH_REQUIRED', lastError: code, lockedUntil: null } });
    if (changed.count) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
      if (user.notificationsEnabled) await tx.notification.upsert({
        where: { userId_dedupeKey: { userId: user.id, dedupeKey: `ued-reauth:${input.id}:${hash(initialSecret)}` } }, update: {},
        create: { userId: user.id, dedupeKey: `ued-reauth:${input.id}:${hash(initialSecret)}`,
          titleVi: 'Cần xác thực lại cổng UED', titleEn: 'Reconnect your UED account',
          bodyVi: 'Phiên đăng nhập của trường đã hết hạn. Mở Kết nối để đăng nhập và hoàn tất CAPTCHA nếu được yêu cầu.',
          bodyEn: 'Your school session has expired. Open Connections to sign in and complete CAPTCHA if requested.' },
      });
    }
  });
}

export function uedEventChange(schedule: UedSchedule, existing?: ExistingEvent) {
  const proposed = { title: schedule.title, startTime: schedule.startTime, endTime: schedule.endTime,
    location: schedule.location, eventType: schedule.eventType };
  const before = existing ? { title: existing.title, startTime: existing.startTime.toISOString(),
    endTime: existing.endTime.toISOString(), location: existing.location, eventType: existing.eventType,
    status: existing.status } : undefined;
  if (schedule.cancelled) {
    if (!existing || existing.status === 'CANCELLED') return null;
    return { action: 'CANCEL' as const, eventId: existing.id, expectedUpdatedAt: existing.updatedAt.toISOString(),
      occurrence: before, before, after: null };
  }
  const changes = proposed;
  if (!existing) return { action: 'CREATE' as const, changes, occurrence: proposed, after: proposed };
  // Restoring an already-cancelled event needs an explicit student decision,
  // not an ambiguous UPDATE that accidentally leaves the event cancelled.
  if (existing.status !== 'SCHEDULED') return { action: 'REVIEW' as const,
    candidateEventIds: [existing.id], eventId: existing.id, expectedUpdatedAt: existing.updatedAt.toISOString(),
    changes, occurrence: proposed, before, after: proposed };
  if (existing.title === changes.title && existing.startTime.toISOString() === changes.startTime
    && existing.endTime.toISOString() === changes.endTime && existing.location === changes.location
    && existing.eventType === changes.eventType) return null;
  return { action: 'UPDATE' as const, eventId: existing.id, expectedUpdatedAt: existing.updatedAt.toISOString(),
    changes, occurrence: proposed, before, after: proposed };
}

/** Presentation-only snapshots must never change a proposal identity. Keeping
 * this projection stable lets newer clients enrich existing pending rows
 * without duplicating every occurrence. */
export function uedChangeIdentity(change: NonNullable<ReturnType<typeof uedEventChange>>) {
  if (change.action === 'CREATE') return { action: change.action, changes: change.changes };
  if (change.action === 'CANCEL') return { action: change.action, eventId: change.eventId, expectedUpdatedAt: change.expectedUpdatedAt };
  if (change.action === 'UPDATE') return { action: change.action, eventId: change.eventId,
    expectedUpdatedAt: change.expectedUpdatedAt, changes: change.changes };
  return { action: change.action, candidateEventIds: change.candidateEventIds, eventId: change.eventId,
    expectedUpdatedAt: change.expectedUpdatedAt, changes: change.changes };
}

/** Link only by a verified student ID. An unverified email never joins accounts. */
export async function connectVerifiedUed(identity: { studentId: string; name?: string }, storageState: UedStorageState, userId?: string) {
  const db = getPrismaClient();
  const perform = async (tx: Prisma.TransactionClient) => {
    let user;
    if (userId) {
      user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new ApiError(401, 'AUTH_REQUIRED');
      if (user.isDemo) throw new ApiError(409, 'UED_DEMO_LINK_FORBIDDEN');
      if (user.studentId && user.studentId !== identity.studentId) throw new ApiError(409, 'UED_IDENTITY_MISMATCH');
      const owner = await tx.user.findUnique({ where: { studentId: identity.studentId } });
      if (owner && owner.id !== userId) throw new ApiError(409, 'UED_ALREADY_LINKED');
      user = await tx.user.update({ where: { id: userId }, data: { studentId: identity.studentId } });
    } else {
      user = await tx.user.upsert({ where: { studentId: identity.studentId }, update: {},
        create: { studentId: identity.studentId, email: `${identity.studentId}@students.ued.invalid`,
          name: identity.name || identity.studentId } });
    }
    const encryptedSecret = encrypt({ version: 1, studentId: identity.studentId, storageState } satisfies UedSecret, `${user.id}:UED`);
    await tx.integration.upsert({ where: { userId_provider: { userId: user.id, provider: 'UED' } },
      create: { userId: user.id, provider: 'UED', status: 'CONNECTED', encryptedSecret },
      update: { status: 'CONNECTED', encryptedSecret, lastError: null, failures: 0, nextSyncAt: new Date(), lockedUntil: null, leaseToken: null } });
    return user;
  };
  return userId ? withUser(userId, perform) : db.$transaction(perform);
}

function evidence(record: UedRecord, at: Date) {
  return { subject: record.title, excerpt: Object.values(record.fields).join(' | ').slice(0, 2000),
    sender: 'UED student portal', receivedAt: at.toISOString(), source: 'UED' as const };
}

/** Expire every older UED interpretation of one stable occurrence. This is
 * also called when the portal and accepted Event already agree: otherwise a
 * proposal produced by an earlier crawl could remain actionable even though
 * it no longer represents the current source of truth. */
async function expirePendingUedProposals(tx: Prisma.TransactionClient, userId: string, externalId: string,
  keepSourceKey?: string) {
  return tx.suggestion.updateMany({ where: {
    userId, kind: 'EVENT_CHANGE', status: 'PENDING',
    ...(keepSourceKey ? { sourceKey: { not: keepSourceKey } } : {}),
    AND: [
      { payload: { path: ['externalId'], equals: externalId } },
      { payload: { path: ['evidence', 'source'], equals: 'UED' } },
    ],
  }, data: { status: 'EXPIRED' } });
}

/** One-time compatibility path for installations that crawled UED before the
 * original timetable became an automatic fixed import. It consumes only
 * internally generated, still-pending UED CREATE proposals, validates every
 * field again, and never contacts or writes to the school portal. */
export async function materializeLegacyUedTimetable(userId: string): Promise<{
  candidates: number; imported: number; retired: number;
}> {
  return withUser(userId, async tx => {
    const suggestions = await tx.suggestion.findMany({ where: {
      userId, kind: 'EVENT_CHANGE', status: 'PENDING',
      AND: [
        { payload: { path: ['action'], equals: 'CREATE' } },
        { payload: { path: ['evidence', 'source'], equals: 'UED' } },
      ],
    }, orderBy: { createdAt: 'asc' } });
    const now = new Date();
    let imported = 0;
    let retired = 0;
    for (const suggestion of suggestions) {
      if (!suggestion.payload || typeof suggestion.payload !== 'object' || Array.isArray(suggestion.payload)) {
        throw new ApiError(409, 'UED_LEGACY_PROPOSAL_INVALID');
      }
      const payload = suggestion.payload as Prisma.JsonObject;
      const evidenceValue = payload.evidence;
      const evidenceValueValid = evidenceValue && typeof evidenceValue === 'object' && !Array.isArray(evidenceValue);
      const evidenceObject = evidenceValueValid ? evidenceValue as Prisma.JsonObject : null;
      if (payload.action !== 'CREATE' || typeof payload.externalId !== 'string' || !payload.externalId
        || payload.externalId.length > 512 || evidenceObject?.source !== 'UED') {
        throw new ApiError(409, 'UED_LEGACY_PROPOSAL_INVALID');
      }
      const parsed = eventInput.safeParse(payload.changes);
      if (!parsed.success || parsed.data.eventType !== 'CLASS') throw new ApiError(409, 'UED_LEGACY_PROPOSAL_INVALID');
      const parsedTerm = payload.term === undefined ? undefined : uedTermSchema.safeParse(payload.term);
      if (parsedTerm && !parsedTerm.success) throw new ApiError(409, 'UED_LEGACY_PROPOSAL_INVALID');
      const existing = await tx.event.findUnique({ where: { userId_source_externalId: {
        userId, source: 'SCHOOL_PORTAL', externalId: payload.externalId,
      } } });
      if (!existing) {
        await tx.event.create({ data: {
          ...parsed.data, userId, status: 'SCHEDULED', source: 'SCHOOL_PORTAL', externalId: payload.externalId,
          sourceMetadata: {
            provider: 'UED', fixed: true, importedAt: now.toISOString(), migratedFromSuggestion: suggestion.id,
            ...(typeof evidenceObject?.receivedAt === 'string' ? { sourceObservedAt: evidenceObject.receivedAt } : {}),
            ...(parsedTerm?.success ? { term: { ...parsedTerm.data } } : {}),
          },
        } });
        imported++;
      }
      await tx.suggestion.update({ where: { id: suggestion.id }, data: { status: 'EXPIRED' } });
      retired++;
    }
    if (imported) {
      await bumpVersion(tx, userId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.notificationsEnabled) await tx.notification.create({ data: { userId,
        titleVi: 'Đã chuyển thời khóa biểu UED thành lịch cố định', titleEn: 'Your UED timetable is now fixed',
        bodyVi: `${imported} buổi học đã được thêm vào lịch. Bộ xếp lịch sẽ không đặt task đè lên các buổi này.`,
        bodyEn: `${imported} class meetings were added to your calendar. Task planning will keep these times free.` } });
    }
    return { candidates: suggestions.length, imported, retired };
  });
}

/** All network work precedes the short transaction. The first successful
 * timetable snapshot for a term becomes fixed school Events; unseen meetings
 * and all other changes in later snapshots require student approval. */
export async function syncUed(integrationId: string, requestedTerm?: UedTerm): Promise<{
  records: number; imported: number; proposals: number;
}> {
  const db = getPrismaClient();
  const integration = await db.integration.findUnique({ where: { id: integrationId } });
  if (!integration || integration.provider !== 'UED' || !integration.encryptedSecret || integration.status !== 'CONNECTED') {
    throw new ApiError(409, 'UED_NOT_CONNECTED');
  }
  const initialSecret = integration.encryptedSecret;
  const initialCursor = integration.cursor && typeof integration.cursor === 'object' && !Array.isArray(integration.cursor)
    ? integration.cursor as Prisma.JsonObject : {};
  // Validate an existing marker before spending a browser crawl. Missing is the
  // expected legacy shape and is inferred conservatively after the crawl.
  readUedBaselineTerms(initialCursor);
  const initialTerm = initialCursor.uedTerm ?? null;
  const initialMode = initialCursor.uedTermMode ?? 'CURRENT';
  // Last observed semester is metadata, not a permanent override. CURRENT
  // follows the school's banner automatically when a new semester starts.
  const termInput = requestedTerm || (initialMode === 'SELECTED' ? initialTerm : null);
  const term = termInput ? uedTermSchema.parse(termInput) : undefined;
  const adapter = getUedAdapter();
  if (adapter.pages.length === 0) throw new ApiError(503, 'UED_SYNC_MAPPING_REQUIRED');
  let secret: UedSecret;
  try {
    secret = parseUedSecret(decrypt<unknown>(initialSecret, `${integration.userId}:UED`));
  } catch (error) {
    logUnexpectedUed('read', error);
    const reauth = error instanceof ApiError && error.code === 'UED_REAUTH_REQUIRED' ? error : new ApiError(409, 'UED_REAUTH_REQUIRED');
    await markUedReauth(integration, initialSecret, reauth.code);
    throw reauth;
  }
  let snapshot: Awaited<ReturnType<typeof readUedPortal>>;
  try {
    snapshot = await readUedPortal(adapter, secret.storageState, secret.studentId, term);
  } catch (error) {
    logUnexpectedUed('read', error);
    if (error instanceof ApiError && ['UED_REAUTH_REQUIRED', 'UED_IDENTITY_MISMATCH'].includes(error.code)) {
      await markUedReauth(integration, initialSecret, error.code);
    }
    throw error;
  }
  try {
    const observedTerms = new Map<string, UedTerm>();
    const rememberTerm = (value: unknown) => {
      const parsed = uedTermSchema.safeParse(value);
      if (!parsed.success) throw new ApiError(502, 'UED_TERM_MAPPING_FAILED');
      observedTerms.set(uedTermKey(parsed.data), parsed.data);
    };
    if (snapshot.termChoices) rememberTerm(snapshot.termChoices.selected);
    for (const record of snapshot.records) if (record.term) rememberTerm(record.term);
    if (observedTerms.size > 1) throw new ApiError(502, 'UED_TERM_MAPPING_FAILED');
    const snapshotTerm = observedTerms.values().next().value as UedTerm | undefined;
    const snapshotTermKey = snapshotTerm ? uedTermKey(snapshotTerm) : undefined;

    return await withUser(integration.userId, async tx => {
    const current = await tx.integration.findUnique({ where: { id: integrationId } });
    // Disconnect/reconnect wins over an in-flight crawl: no records, secrets or
    // proposals may be written from the previous session after that decision.
    const currentCursor = current?.cursor && typeof current.cursor === 'object' && !Array.isArray(current.cursor)
      ? current.cursor as Prisma.JsonObject : {};
    if (!current || current.status !== 'CONNECTED' || current.encryptedSecret !== initialSecret || current.leaseToken !== integration.leaseToken
      || JSON.stringify(currentCursor.uedTerm ?? null) !== JSON.stringify(initialTerm)
      || (currentCursor.uedTermMode ?? 'CURRENT') !== initialMode) throw new ApiError(409, 'UED_SYNC_SUPERSEDED');
    const user = await tx.user.findUniqueOrThrow({ where: { id: integration.userId } });
    if (user.studentId !== secret.studentId) throw new ApiError(409, 'UED_IDENTITY_MISMATCH');
    const now = new Date();
    const baselineTerms = readUedBaselineTerms(currentCursor);

    if (snapshotTerm && snapshotTermKey && !baselineTerms.has(snapshotTermKey)) {
      // Cursors written before this marker existed still contain the last
      // successfully mapped term. AcademicRecord evidence covers older terms
      // after the user has subsequently selected another one.
      const legacyCursorTerm = uedTermSchema.safeParse(currentCursor.uedTerm);
      const mappedPages = Array.isArray(currentCursor.mappedPages)
        ? currentCursor.mappedPages.filter((value): value is string => typeof value === 'string') : [];
      const termPageKeys = adapter.pages.filter(page => page.termFilter).map(page => page.key);
      const cursorProvesBaseline = !!current.lastSyncAt && legacyCursorTerm.success
        && uedTermKey(legacyCursorTerm.data) === snapshotTermKey
        && termPageKeys.some(pageKey => mappedPages.includes(pageKey));
      const storedRecord = cursorProvesBaseline ? null : await tx.academicRecord.findFirst({ where: {
        userId: user.id, category: 'SCHEDULE',
        AND: [
          { data: { path: ['provider'], equals: 'UED' } },
          { data: { path: ['term', 'academicYear'], equals: snapshotTerm.academicYear } },
          { data: { path: ['term', 'semester'], equals: snapshotTerm.semester } },
        ],
      }, select: { id: true } });
      if (cursorProvesBaseline || storedRecord) baselineTerms.add(snapshotTermKey);
    }

    const scheduledRows = [...snapshot.records.filter(record => record.schedule), ...expandTimetable(snapshot.records, snapshot.weekRanges || [], adapter.timezone)];
    const events = await tx.event.findMany({ where: { userId: user.id, source: 'SCHOOL_PORTAL',
      externalId: { in: scheduledRows.map(record => record.externalId) } } });
    const eventByExternalId = new Map(events.map(event => [event.externalId, event]));
    let imported = 0;
    let proposals = 0;
    for (const record of snapshot.records) {
      const data = { fields: record.fields, pageKey: record.pageKey, provider: 'UED',
        ...(record.term ? { term: { ...record.term }, weekRanges: (snapshot.weekRanges || []).map(week => ({ ...week })) } : {}) };
      await tx.academicRecord.upsert({ where: { userId_category_externalId: { userId: user.id, category: record.category, externalId: record.externalId } },
        create: { userId: user.id, category: record.category, externalId: record.externalId, title: record.title,
          data, syncedAt: now },
        update: { title: record.title, data, syncedAt: now } });
    }
    for (const record of scheduledRows) {
      if (!record.schedule) continue;
      const existing = eventByExternalId.get(record.externalId);

      const recordTermKey = record.term ? uedTermKey(record.term) : undefined;
      const termAlreadyBaselined = record.schedule.eventType === 'CLASS' && !!recordTermKey
        && baselineTerms.has(recordTermKey);

      // Only the first successful snapshot of an academic term is fixed input.
      // An unseen class in a later snapshot is a source change and continues
      // below as a CREATE proposal requiring the student's approval.
      if (!existing && !record.schedule.cancelled && !termAlreadyBaselined) {
        const created = await tx.event.create({ data: {
          userId: user.id,
          title: record.schedule.title,
          startTime: new Date(record.schedule.startTime),
          endTime: new Date(record.schedule.endTime),
          location: record.schedule.location,
          eventType: record.schedule.eventType,
          status: 'SCHEDULED',
          source: 'SCHOOL_PORTAL',
          externalId: record.externalId,
          sourceMetadata: {
            provider: 'UED', fixed: true, importedAt: now.toISOString(), pageKey: record.pageKey,
            ...(record.term ? { term: { ...record.term } } : {}),
          },
        } });
        eventByExternalId.set(record.externalId, created);
        // This also retires CREATE proposals made before fixed timetable
        // imports became automatic, so they cannot later duplicate the Event.
        await expirePendingUedProposals(tx, user.id, record.externalId);
        imported++;
        continue;
      }

      const change = uedEventChange(record.schedule, existing);
      if (!change) {
        // The accepted calendar now matches the latest portal observation.
        // Any older pending CREATE/UPDATE/CANCEL for this occurrence is stale.
        await expirePendingUedProposals(tx, user.id, record.externalId);
        continue;
      }
      const sourceKey = `ued:${hash(JSON.stringify({ record: record.externalId, change: uedChangeIdentity(change) }))}`;
      // A later observation for the same occurrence supersedes any older,
      // still-pending interpretation (including proposals made by an older
      // payload format). It remains visible as expired history, never actionable.
      await expirePendingUedProposals(tx, user.id, record.externalId, sourceKey);
      const known = await tx.suggestion.findUnique({ where: { userId_sourceKey: { userId: user.id, sourceKey } } });
      const payload = { ...change, externalId: record.externalId,
        ...(record.term ? { term: { ...record.term } } : {}), evidence: evidence(record, now) };
      // Keep pending evidence/semester metadata fresh. A proposal that simply
      // timed out may be offered again; an explicit accept/reject remains final
      // until the portal data itself changes and therefore produces a new key.
      if (known) {
        if (known.status === 'PENDING' && +known.expiresAt > +now) {
          await tx.suggestion.update({ where: { id: known.id }, data: { payload, baseVersion: user.scheduleVersion,
            titleVi: `UED: ${record.title}`.slice(0, 255), titleEn: `UED: ${record.title}`.slice(0, 255) } });
        } else if (known.status === 'EXPIRED' || (known.status === 'PENDING' && +known.expiresAt <= +now)) {
          await tx.suggestion.update({ where: { id: known.id }, data: { status: 'PENDING', decidedAt: null,
            payload, baseVersion: user.scheduleVersion, expiresAt: new Date(+now + 7 * 86_400_000),
            titleVi: `UED: ${record.title}`.slice(0, 255), titleEn: `UED: ${record.title}`.slice(0, 255) } });
          proposals++;
        }
        continue;
      }
      await tx.suggestion.create({ data: { userId: user.id, kind: 'EVENT_CHANGE', sourceKey,
        baseVersion: user.scheduleVersion, titleVi: `UED: ${record.title}`.slice(0, 255),
        titleEn: `UED: ${record.title}`.slice(0, 255), expiresAt: new Date(+now + 7 * 86_400_000),
        payload } });
      proposals++;
    }
    if (snapshotTermKey) {
      baselineTerms.add(snapshotTermKey);
      if (baselineTerms.size > MAX_UED_BASELINE_TERMS) throw new ApiError(409, 'UED_BASELINE_CURSOR_INVALID');
    }
    if (imported) await bumpVersion(tx, user.id);
    await tx.integration.update({ where: { id: integrationId }, data: {
      encryptedSecret: encrypt({ ...secret, storageState: snapshot.storageState }, `${user.id}:UED`),
      lastSyncAt: now, nextSyncAt: new Date(+now + 15 * 60_000), failures: 0, lastError: null,
      cursor: { ...currentCursor, mappedPages: adapter.pages.map(page => page.key), recordCount: snapshot.records.length,
        importedCount: imported, proposalCount: proposals,
        ...(snapshotTermKey ? { [UED_TIMETABLE_BASELINE_CURSOR_KEY]: [...baselineTerms].sort() } : {}),
        ...(snapshot.termChoices ? { uedTerm: { ...snapshot.termChoices.selected },
          uedTermChoices: JSON.parse(JSON.stringify(snapshot.termChoices)) as Prisma.InputJsonValue } : {}),
        ...(snapshot.weekRanges ? { uedWeekRanges: snapshot.weekRanges.map(week => ({ ...week })) } : {}) },
    } });
    if (imported && user.notificationsEnabled) await tx.notification.create({ data: { userId: user.id,
      titleVi: 'Đã thêm lịch học cố định từ UED', titleEn: 'Your fixed UED timetable is ready',
      bodyVi: `${imported} buổi học đã được thêm thẳng vào lịch và sẽ được giữ cố định khi xếp task.`,
      bodyEn: `${imported} class meetings were added directly to your calendar and remain fixed while tasks are planned.` } });
    if (proposals && user.notificationsEnabled) await tx.notification.create({ data: { userId: user.id,
      titleVi: 'Có cập nhật lịch từ UED', titleEn: 'UED schedule updates are ready',
      bodyVi: `${proposals} đề xuất đang chờ bạn xem và xác nhận. Lịch hiện tại chưa thay đổi.`,
      bodyEn: `${proposals} proposals are waiting for your review. Your confirmed calendar has not changed.` } });
    return { records: snapshot.records.length, imported, proposals };
  }); } catch (error) {
    logUnexpectedUed('persist', error);
    throw error;
  }
}
