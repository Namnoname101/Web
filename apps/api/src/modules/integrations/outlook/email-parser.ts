import { convert } from 'html-to-text';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export interface MailMessage {
  id: string;
  internetMessageId?: string;
  subject?: string;
  body?: { contentType?: string; content?: string };
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
  isDraft?: boolean;
}

export interface MailEvent {
  id: string; title: string; startTime: Date; endTime: Date;
  location?: string | null; updatedAt: Date;
}

export interface EventChangePayload {
  eventId?: string;
  expectedUpdatedAt?: string;
  action: 'CANCEL' | 'UPDATE' | 'CREATE' | 'REVIEW';
  changes?: { title?: string; startTime?: string; endTime?: string; location?: string; eventType?: 'CLASS' };
  evidence: { subject: string; excerpt: string; sender?: string; receivedAt?: string; source: 'OUTLOOK' | 'UED' };
  candidateEventIds?: string[];
}

/** Normalize accents for bilingual matching, but keep the original evidence for the student. */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

export function readableMail(message: MailMessage): string {
  const content = (message.body?.content || '').slice(0, 100_000);
  const plain = message.body?.contentType?.toLowerCase() === 'html'
    ? convert(content, { wordwrap: false, selectors: [{ selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' }, { selector: 'blockquote', format: 'skip' },
      { selector: 'script', format: 'skip' }, { selector: 'style', format: 'skip' }] })
    : content;
  // Old quoted correspondence is not evidence of a new class change.
  return plain.split(/\n(?:-{2,}\s*(?:Original Message|Thư gốc)|On .{1,200} wrote:|Vào .{1,200} đã viết:)/i)[0]
    .split('\n').filter(line => !/^\s*>/.test(line)).join('\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 32_000);
}

interface DateMention { key: string; index: number; end: number }
interface TimeRange { start: string; end: string; index: number }
const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function dateKey(year: number, month: number, day: number): string | undefined {
  if (year < 2000 || year > 2199 || month < 1 || month > 12 || day < 1 || day > 31) return;
  const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const value = new Date(`${key}T12:00:00Z`);
  return Number.isFinite(+value) && value.toISOString().slice(0, 10) === key ? key : undefined;
}

/** Only dates with an explicit year are actionable; tomorrow/next week remain review-only. */
function dates(text: string): DateMention[] {
  const result: DateMention[] = [];
  const add = (match: RegExpMatchArray, key?: string) => {
    if (key) result.push({ key, index: match.index!, end: match.index! + match[0].length });
  };
  for (const m of text.matchAll(/\b(20\d{2}|21\d{2})-(\d{1,2})-(\d{1,2})\b/g)) add(m, dateKey(+m[1], +m[2], +m[3]));
  // Vietnamese numeric dates are day/month/year. Ambiguous English numeric dates stay review-only below.
  for (const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2}|21\d{2})\b/g)) add(m, dateKey(+m[3], +m[2], +m[1]));
  for (const m of text.matchAll(/\b(?:ngay\s+)?(\d{1,2})\s+thang\s+(\d{1,2})\s+(?:nam\s+)?(20\d{2}|21\d{2})\b/g)) add(m, dateKey(+m[3], +m[2], +m[1]));
  const month = `(${months.join('|')})`;
  for (const m of text.matchAll(new RegExp(`\\b${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(20\\d{2}|21\\d{2})\\b`, 'g'))) {
    add(m, dateKey(+m[3], months.indexOf(m[1]) + 1, +m[2]));
  }
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${month}[,]?\\s+(20\\d{2}|21\\d{2})\\b`, 'g'))) {
    add(m, dateKey(+m[3], months.indexOf(m[2]) + 1, +m[1]));
  }
  return result.sort((a, b) => a.index - b.index);
}

function ranges(text: string): TimeRange[] {
  const clock = '(\\d{1,2})(?:(?::|h|g)(\\d{2})?)?\\s*(am|pm)?';
  const expression = new RegExp(`\\b${clock}\\s*(?:-|–|—|to|den|toi)\\s*${clock}\\b`, 'g');
  const result: TimeRange[] = [];
  for (const m of text.matchAll(expression)) {
    // A pair of bare integers could be dates, rooms, or class periods; never guess.
    if (!/[:hg]|am|pm/.test(m[0])) continue;
    const convertClock = (hour: string, minute: string | undefined, suffix: string | undefined) => {
      let h = +hour;
      const mm = +(minute || '0');
      if (mm > 59 || h > 23 || (suffix && (h < 1 || h > 12))) return;
      if (suffix) h = (h % 12) + (suffix === 'pm' ? 12 : 0);
      return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    };
    // Do not infer missing AM/PM for "9–11am" or "11am–1".
    if (Boolean(m[3]) !== Boolean(m[6])) continue;
    const start = convertClock(m[1], m[2], m[3]);
    const end = convertClock(m[4], m[5], m[6]);
    if (start && end && start < end) result.push({ start, end, index: m.index! });
  }
  return result;
}

function localInstant(key: string, clock: string, timezone: string): string | undefined {
  const wall = `${key}T${clock}:00`;
  const date = fromZonedTime(wall, timezone);
  if (!Number.isFinite(+date) || formatInTimeZone(date, timezone, "yyyy-MM-dd'T'HH:mm:ss") !== wall) return;
  // An ambiguous repeated hour at the autumn DST transition needs human interpretation.
  for (const delta of [-7_200_000, -3_600_000, -1_800_000, 1_800_000, 3_600_000, 7_200_000]) {
    if (formatInTimeZone(new Date(+date + delta), timezone, "yyyy-MM-dd'T'HH:mm:ss") === wall) return;
  }
  return date.toISOString();
}

function mentionedTitle(text: string, title: string): boolean {
  const normalized = normalizeText(title);
  if (normalized.length < 3) return false;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(text);
}

/**
 * Rule-based, deliberately conservative parser. It never changes an event. An actionable
 * proposal needs the full existing title, a full date and exactly one matching event.
 * Incomplete, negated, multi-class, or ambiguous messages are surfaced for manual review.
 */
export function parseScheduleEmail(message: MailMessage, events: MailEvent[], timezone: string, now?: Date): EventChangePayload | null {
  if (message.isDraft) return null;
  const subject = (message.subject || '').slice(0, 255);
  const body = readableMail(message);
  const text = normalizeText(`${subject}\n${body}`);
  const cancellation = /\b(cancelled|canceled|cancellation|huy (?:lich|lop|buoi|tiet)|nghi hoc|nghi buoi|khong hoc)\b/.test(text);
  const movement = /\b(reschedul(?:e|ed|ing)|postpon(?:e|ed)|doi (?:lich|gio)|chuyen (?:lich|sang)|hoan (?:lich|buoi|lop)|moved (?:to|from))\b/.test(text);
  const room = /\b(room (?:change|changed)|change (?:of )?room|doi phong|chuyen phong|new room|phong moi)\b/.test(text);
  if (!(cancellation || movement || room)) return null;
  const evidence: EventChangePayload['evidence'] = { subject, excerpt: body.replace(/\s+/g, ' ').trim().slice(0, 600), source: 'OUTLOOK' };
  const sender = message.from?.emailAddress?.address;
  if (sender) evidence.sender = sender.slice(0, 320);
  if (message.receivedDateTime && Number.isFinite(Date.parse(message.receivedDateTime))) evidence.receivedAt = new Date(message.receivedDateTime).toISOString();
  const titleMatches = events.filter(event => mentionedTitle(text, event.title));
  // Scanning every folder does not mean treating cancelled orders or newsletters as classes.
  if (!titleMatches.length && !/\b(class|lecture|course|seminar|lop|lich hoc|buoi hoc|mon hoc|tiet hoc)\b/.test(text)) return null;
  const mentions = dates(text);
  // Repeated dates in a subject/body are the same evidence, but order still matters for moves.
  const distinct = mentions.filter((item, i) => mentions.findIndex(other => other.key === item.key) === i);
  if (now) {
    const today = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
    // The first full-mailbox scan still reads historical messages, but an old
    // notice must not crowd the review queue for a calendar date already over.
    if (distinct.length && distinct.every(item => item.key < today)) return null;
    const received = Date.parse(message.receivedDateTime || '');
    if (!distinct.length && Number.isFinite(received) && received < +now - 7 * 86_400_000) return null;
  }
  const review: EventChangePayload = { action: 'REVIEW', evidence, candidateEventIds: titleMatches.map(event => event.id).slice(0, 50) };
  const negated = /\b(?:not|never)\s+(?:(?:be|been|being)\s+)?(?:cancelled|canceled|rescheduled|postponed)|\b(?:khong|chua)\s+(?:bi\s+)?(?:huy|doi lich|nghi hoc|hoan)\b|\bif (?:the )?(?:class|lecture) (?:is )?cancelled\b/.test(text);
  const englishNumericAmbiguity = !/\b(ngay|lich|lop|mon|hoc|phong|buoi)\b/.test(text)
    && /\b(?:0?[1-9]|1[0-2])[/.](?:0?[1-9]|1[0-2])[/.](?:20|21)\d{2}\b/.test(text);
  const uncertain = /\b(if|whether|neu|lieu)\b|\?|\b(utc|gmt|pst|pdt|est|edt|cet|cest)\b|\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/.test(text);
  if (negated || uncertain || englishNumericAmbiguity || distinct.length === 0 || distinct.length > (movement ? 2 : 1)
    || (cancellation && (movement || room))) return review;
  // Multiple distinct event titles in the same mail are not treated as a single cancellation.
  if (new Set(titleMatches.map(event => normalizeText(event.title))).size > 1) return review;
  const originalDate = distinct[0];
  const targetDate = distinct.at(-1)!;
  let candidates = titleMatches.filter(event => formatInTimeZone(event.startTime, timezone, 'yyyy-MM-dd') === originalDate.key);
  const timeRanges = ranges(text);
  const oldRanges = timeRanges.filter(range => range.index >= originalDate.end && (distinct.length === 1 || range.index < targetDate.index));
  const distinctOldRanges = oldRanges.filter((range, i) => oldRanges.findIndex(other => other.start === range.start && other.end === range.end) === i);
  if (!movement && distinctOldRanges.length > 1) return review;
  // For same-day moves the only range can be the new time. Otherwise explicit old
  // times must match even when there is just one class that day.
  if (oldRanges.length && (!movement || distinct.length === 2 || distinctOldRanges.length > 1)) {
    candidates = candidates.filter(event => formatInTimeZone(event.startTime, timezone, 'HH:mm') === oldRanges[0].start
      && formatInTimeZone(event.endTime, timezone, 'HH:mm') === oldRanges[0].end);
  }
  if (candidates.length !== 1) return review;
  const event = candidates[0];
  const base = { eventId: event.id, expectedUpdatedAt: event.updatedAt.toISOString(), evidence };
  if (cancellation) return { ...base, action: 'CANCEL' };
  const changes: NonNullable<EventChangePayload['changes']> = {};
  if (movement) {
    const newRanges = timeRanges.filter(range => range.index >= targetDate.end);
    const newRange = newRanges.at(-1);
    if (!newRange || newRanges.length > (distinct.length === 1 ? 2 : 1)) return review;
    // Require explicit movement language leading into the new range/date.
    const moveText = text.slice(0, distinct.length === 2 ? targetDate.index : newRange.index);
    if (!/\b(to|sang|den|new time|gio moi)\b/.test(moveText)) return review;
    const startTime = localInstant(targetDate.key, newRange.start, timezone);
    const endTime = localInstant(targetDate.key, newRange.end, timezone);
    if (!startTime || !endTime || startTime >= endTime) return review;
    changes.startTime = startTime;
    changes.endTime = endTime;
  }
  if (room) {
    // Only the explicitly labelled new room is used; never take the old room after "from".
    const match = /(?:new room|phong moi|chuyen (?:sang )?phong|doi phong (?:sang|thanh)|room changed to|room change to|change room to)\s*[:\-]?\s*([a-z0-9][a-z0-9._-]{0,30})\b/.exec(text);
    if (!match || ['from', 'to', 'tu', 'sang', 'thanh'].includes(match[1])) return review;
    changes.location = match[1].toUpperCase();
  }
  if (!Object.keys(changes).length) return review;
  if ((!changes.startTime || changes.startTime === event.startTime.toISOString())
    && (!changes.endTime || changes.endTime === event.endTime.toISOString())
    && (!changes.location || normalizeText(changes.location) === normalizeText(event.location || ''))) return null;
  return { ...base, action: 'UPDATE', changes };
}
