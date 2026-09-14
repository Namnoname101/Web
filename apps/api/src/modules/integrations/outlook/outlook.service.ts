import { getPrismaClient, Prisma } from '@personal-schedule/database';
import { decrypt, encrypt, hash } from '../../../lib/crypto.js';
import { ApiError } from '../../../lib/errors.js';
import { withUser } from '../../../lib/transaction.js';
import { parseScheduleEmail, type MailMessage, type EventChangePayload } from './email-parser.js';
import { graphGet, requestTokens, trustedGraphUrl, OutlookThrottleError, type MicrosoftTokens } from './oauth.js';

interface MailPage { value: MailMessage[]; '@odata.nextLink'?: string }
interface MailCursor { nextLink?: string; scanStartedAt?: string; completedThrough?: string }
export interface OutlookSyncResult { processed: number; proposed: number; complete: boolean }
const GRAPH_MESSAGES = 'https://graph.microsoft.com/v1.0/me/messages';
const MAIL_INDEXING_OVERLAP_MS = 24 * 60 * 60_000;

function storedTokens(value: unknown): MicrosoftTokens {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(401, 'OUTLOOK_REAUTH_REQUIRED');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.accessToken !== 'string' || !candidate.accessToken || candidate.accessToken.length > 65_536
    || typeof candidate.refreshToken !== 'string' || !candidate.refreshToken || candidate.refreshToken.length > 65_536
    || typeof candidate.expiresAt !== 'number' || !Number.isFinite(candidate.expiresAt)
    || (candidate.accountId !== undefined && (typeof candidate.accountId !== 'string' || !candidate.accountId || candidate.accountId.length > 255))) {
    throw new ApiError(401, 'OUTLOOK_REAUTH_REQUIRED');
  }
  return { accessToken: candidate.accessToken, refreshToken: candidate.refreshToken,
    expiresAt: candidate.expiresAt, ...(candidate.accountId ? { accountId: candidate.accountId as string } : {}) };
}

function storedCursor(value: unknown): MailCursor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const candidate = value as Record<string, unknown>;
  const completedThrough = typeof candidate.completedThrough === 'string' && Number.isFinite(Date.parse(candidate.completedThrough))
    ? new Date(candidate.completedThrough).toISOString() : undefined;
  const scanStartedAt = typeof candidate.scanStartedAt === 'string' && Number.isFinite(Date.parse(candidate.scanStartedAt))
    ? new Date(candidate.scanStartedAt).toISOString() : undefined;
  // A continuation URL without its fixed upper watermark could advance past
  // messages. Discard the pair and rescan; immutable message IDs deduplicate.
  if (typeof candidate.nextLink === 'string' && scanStartedAt) {
    return { ...(completedThrough ? { completedThrough } : {}), nextLink: candidate.nextLink, scanStartedAt };
  }
  return completedThrough ? { completedThrough } : {};
}

/** A received-time watermark scans all mailbox folders, not just Inbox. */
export function initialMailPage(cursor: MailCursor, upper: string): string {
  const url = new URL(GRAPH_MESSAGES);
  url.searchParams.set('$select', 'id,internetMessageId,subject,body,from,receivedDateTime,isDraft');
  url.searchParams.set('$top', '50');
  url.searchParams.set('$orderby', 'receivedDateTime desc');
  let filter = `receivedDateTime le ${upper}`;
  if (cursor.completedThrough && Number.isFinite(Date.parse(cursor.completedThrough))) {
    // A full-day overlap tolerates delayed Graph indexing far beyond one worker
    // interval. Immutable message IDs keep the repeated scan idempotent.
    filter += ` and receivedDateTime ge ${new Date(Date.parse(cursor.completedThrough) - MAIL_INDEXING_OVERLAP_MS).toISOString()}`;
  }
  url.searchParams.set('$filter', filter);
  return url.toString();
}

export function mailSourceKey(message: MailMessage): string {
  // ImmutableId is requested on every page. The hash is fixed-size even for very long Message-IDs.
  return `OUTLOOK:${hash(message.id)}`;
}

function titles(payload: EventChangePayload): { vi: string; en: string } {
  if (payload.action === 'CANCEL') return { vi: 'Email thông báo hủy buổi học', en: 'Email reports a class cancellation' };
  if (payload.action === 'UPDATE') return { vi: 'Email thông báo thay đổi lịch học', en: 'Email reports a schedule change' };
  return { vi: 'Email cần bạn kiểm tra lịch học', en: 'An email needs your schedule review' };
}

/**
 * Run under the worker's integration lease. Each page is committed independently, so a
 * large mailbox resumes on the next job. No email content survives except bounded evidence
 * on a proposal; confirmed events and task blocks are never written by this service.
 */
export async function syncOutlook(integrationId: string): Promise<OutlookSyncResult> {
  const prisma = getPrismaClient();
  const integration = await prisma.integration.findUnique({ where: { id: integrationId }, include: { user: true } });
  if (!integration || integration.provider !== 'OUTLOOK' || integration.status !== 'CONNECTED' || !integration.encryptedSecret) {
    throw new ApiError(409, 'OUTLOOK_NOT_CONNECTED');
  }
  let expectedSecret = integration.encryptedSecret;
  const leaseToken = integration.leaseToken;
  let tokens: MicrosoftTokens;
  let cursor: MailCursor;
  let upper: string;
  let nextLink: string | undefined;
  const result: OutlookSyncResult = { processed: 0, proposed: 0, complete: false };
  const stopAfter = Date.now() + 90_000;

  async function refresh() {
    const replacement = await requestTokens({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }, tokens.refreshToken);
    tokens = { ...replacement, accountId: tokens.accountId };
    const encryptedSecret = encrypt(tokens, `${integration!.userId}:OUTLOOK`);
    const changed = await prisma.integration.updateMany({ where: { id: integrationId, status: 'CONNECTED', encryptedSecret: expectedSecret, leaseToken }, data: { encryptedSecret } });
    if (changed.count !== 1) throw new ApiError(409, 'INTEGRATION_CHANGED');
    expectedSecret = encryptedSecret;
  }

  try {
    try { tokens = storedTokens(decrypt<unknown>(expectedSecret, `${integration.userId}:OUTLOOK`)); }
    catch { throw new ApiError(401, 'OUTLOOK_REAUTH_REQUIRED'); }
    cursor = storedCursor(integration.cursor);
    upper = cursor.nextLink && cursor.scanStartedAt ? cursor.scanStartedAt : new Date().toISOString();
    nextLink = cursor.nextLink ? trustedGraphUrl(cursor.nextLink) : initialMailPage(cursor, upper);
    if (!Number.isFinite(tokens.expiresAt) || tokens.expiresAt <= Date.now() + 60_000) await refresh();
    const parserNow = new Date();
    const events = await prisma.event.findMany({ where: { userId: integration.userId, eventType: 'CLASS', status: 'SCHEDULED', endTime: { gt: new Date() } },
      select: { id: true, title: true, startTime: true, endTime: true, location: true, updatedAt: true } });
    // Limit work per lease; remaining pages are continued without advancing the watermark.
    for (let pageNumber = 0; nextLink && pageNumber < 8 && (pageNumber === 0 || Date.now() < stopAfter); pageNumber++) {
      let page: MailPage;
      try { page = await graphGet<MailPage>(nextLink, tokens.accessToken); }
      catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'OUTLOOK_REAUTH_REQUIRED') throw error;
        await refresh();
        page = await graphGet<MailPage>(nextLink, tokens.accessToken);
      }
      if (!page || !Array.isArray(page.value) || page.value.some(mail => typeof mail?.id !== 'string' || !mail.id)) {
        throw new ApiError(502, 'OUTLOOK_INVALID_RESPONSE');
      }
      const following = page['@odata.nextLink'];
      if (following && (typeof following !== 'string' || trustedGraphUrl(following) === nextLink)) throw new ApiError(502, 'OUTLOOK_INVALID_PAGE');
      if (following && new URL(following).pathname !== '/v1.0/me/messages') throw new ApiError(502, 'OUTLOOK_INVALID_PAGE');
      const proposals = page.value.flatMap(mail => {
        const payload = parseScheduleEmail(mail, events, integration.user.timezone, parserNow);
        return payload ? [{ payload, sourceKey: mailSourceKey(mail) }] : [];
      });
      const pageProposed = await withUser(integration.userId, async tx => {
        const current = await tx.integration.findUnique({ where: { id: integrationId } });
        if (!current || current.status !== 'CONNECTED' || current.encryptedSecret !== expectedSecret || current.leaseToken !== leaseToken) {
          throw new ApiError(409, 'INTEGRATION_CHANGED');
        }
        const user = await tx.user.findUniqueOrThrow({ where: { id: integration.userId } });
        let created = 0;
        for (const proposal of proposals) {
          const label = titles(proposal.payload);
          const inserted = await tx.suggestion.createMany({ data: [{ userId: integration.userId, kind: 'EVENT_CHANGE',
            titleVi: label.vi, titleEn: label.en, payload: proposal.payload as unknown as Prisma.InputJsonValue,
            sourceKey: proposal.sourceKey, baseVersion: user.scheduleVersion, expiresAt: new Date(Date.now() + 14 * 86_400_000) }], skipDuplicates: true });
          if (!inserted.count) continue;
          created++;
          if (user.notificationsEnabled) {
            await tx.notification.createMany({ data: [{ userId: user.id, titleVi: label.vi, titleEn: label.en,
              bodyVi: 'Hãy xem bằng chứng và xác nhận. Lịch của bạn chưa bị thay đổi.',
              bodyEn: 'Review the evidence and confirm. Your calendar has not changed.',
              dedupeKey: proposal.sourceKey }], skipDuplicates: true });
          }
        }
        const nextCursor: MailCursor = following ? { ...cursor, nextLink: following, scanStartedAt: upper } : { completedThrough: upper };
        await tx.integration.update({ where: { id: integrationId }, data: { cursor: nextCursor as Prisma.InputJsonValue,
          ...(following ? {} : { lastSyncAt: new Date() }), failures: 0, lastError: null,
          nextSyncAt: new Date(Date.now() + (following ? 5_000 : 5 * 60_000)) } });
        return created;
      });
      result.processed += page.value.length;
      result.proposed += pageProposed;
      nextLink = following;
    }
    result.complete = !nextLink;
    return result;
  } catch (error) {
    const reauth = error instanceof ApiError && ['OUTLOOK_REAUTH_REQUIRED', 'OUTLOOK_READ_CONSENT_REQUIRED'].includes(error.code);
    const delay = error instanceof OutlookThrottleError ? error.retryAfterMs : Math.min(3_600_000, 60_000 * 2 ** Math.min(integration.failures, 6));
    // A disconnect or reconnect wins over an in-flight HTTP request, even across processes.
    const changed = await prisma.integration.updateMany({ where: { id: integrationId, status: 'CONNECTED', encryptedSecret: expectedSecret, leaseToken }, data: {
      ...(reauth ? { status: 'REAUTH_REQUIRED' } : {}), failures: { increment: 1 },
      lastError: error instanceof ApiError ? error.code : 'OUTLOOK_SYNC_FAILED', nextSyncAt: new Date(Date.now() + delay) } });
    if (changed.count && reauth && integration.user.notificationsEnabled) {
      await prisma.notification.upsert({
        where: { userId_dedupeKey: { userId: integration.userId, dedupeKey: `outlook-reauth:${integrationId}:${hash(expectedSecret)}` } },
        update: {},
        create: { userId: integration.userId, dedupeKey: `outlook-reauth:${integrationId}:${hash(expectedSecret)}`,
          titleVi: 'Cần kết nối lại Outlook', titleEn: 'Reconnect your Outlook account',
          bodyVi: 'Quyền đọc email đã hết hạn hoặc không còn hợp lệ. Mở Kết nối để đăng nhập Microsoft lại.',
          bodyEn: 'Mailbox access expired or is no longer valid. Open Connections to sign in to Microsoft again.' },
      });
    }
    throw error;
  }
}
