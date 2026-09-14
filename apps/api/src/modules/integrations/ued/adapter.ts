import { isValid, parse, format } from 'date-fns';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { z } from 'zod';
import { hash } from '../../../lib/crypto.js';
import { ApiError } from '../../../lib/errors.js';

export const UED_ORIGIN = 'https://qlht.ued.udn.vn';
export const UED_LOGIN_PATH = '/login/login';

// Operators configure mappings from observed portal pages. No private URLs,
// post-login selectors, period lengths or semester dates are guessed here.
const fieldSchema = z.object({
  selector: z.string().min(1).max(500),
  attribute: z.string().regex(/^[a-zA-Z][\w-]*$/).optional(),
}).strict();

const scheduleSchema = z.object({
  titleField: z.string(), startField: z.string(), endField: z.string(),
  dateTimeFormat: z.string().min(1).max(80),
  locationField: z.string().optional(),
  eventType: z.enum(['CLASS', 'DEADLINE']).default('CLASS'),
  cancelledField: z.string().optional(),
  cancelledValues: z.array(z.string()).max(10).default([]),
}).strict();

const pageSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  path: z.string().min(1).max(1000),
  entry: z.object({ path: z.string().min(1).max(1000), selector: z.string().min(1).max(500) }).strict().optional(),
  title: z.string().min(1).max(255),
  category: z.enum(['SCHEDULE', 'EXAM', 'COURSE', 'GRADE', 'ATTENDANCE', 'ANNOUNCEMENT', 'OTHER']),
  readySelector: z.string().min(1).max(500),
  rowSelector: z.string().min(1).max(500),
  fields: z.record(z.string().regex(/^[a-zA-Z][\w]{0,63}$/), fieldSchema)
    .refine(fields => Object.keys(fields).length > 0 && Object.keys(fields).length <= 40),
  idField: z.string(), titleField: z.string(),
  // Several timetable rows can share a course/group. Their weekday and period
  // mask distinguish meetings without depending on a mutable row position.
  identityFields: z.array(z.string()).min(1).max(12).optional(),
  termFilter: z.literal('UED_TIMETABLE').optional(),
  schedule: scheduleSchema.optional(),
}).strict().superRefine((page, ctx) => {
  const fields = [page.idField, page.titleField, ...(page.identityFields || []), ...[page.schedule?.titleField, page.schedule?.startField,
    page.schedule?.endField, page.schedule?.locationField, page.schedule?.cancelledField].filter(Boolean)];
  for (const name of fields) if (!(name! in page.fields)) ctx.addIssue({ code: 'custom', message: `Missing field mapping: ${name}` });
  try { trustedUedUrl(page.path); } catch { ctx.addIssue({ code: 'custom', message: 'Page must be a trusted read-only UED URL.' }); }
  if (page.termFilter && (page.path !== '/sinhvien/thoikhoabieu' || page.entry?.path !== '/sinhvien' || page.entry.selector !== '#thoikhoabieu')) {
    ctx.addIssue({ code: 'custom', message: 'The verified timetable requires its observed home-menu entry path.' });
  }
  if (page.entry) try { trustedUedUrl(page.entry.path); } catch { ctx.addIssue({ code: 'custom', message: 'Page entry must be a trusted read-only UED URL.' }); }
});

export const uedAdapterSchema = z.object({
  version: z.literal(1),
  timezone: z.string().default('Asia/Ho_Chi_Minh').refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }),
  auth: z.object({
    identityPath: z.string().min(1).max(1000),
    landingPaths: z.array(z.string().min(1).max(1000)).max(10).default([]),
    authenticatedSelector: z.string().min(1).max(500),
    studentIdSelector: z.string().min(1).max(500),
    studentIdAttribute: z.string().regex(/^[a-zA-Z][\w-]*$/).optional(),
    nameSelector: z.string().min(1).max(500).optional(),
    nameAttribute: z.string().regex(/^[a-zA-Z][\w-]*$/).optional(),
    captchaInputSelector: z.string().min(1).max(500).optional(),
    captchaImageSelector: z.string().min(1).max(500).optional(),
  }).strict(),
  pages: z.array(pageSchema).max(30),
}).strict().superRefine((adapter, ctx) => {
  for (const path of [adapter.auth.identityPath, ...adapter.auth.landingPaths]) {
    try { trustedUedUrl(path); } catch { ctx.addIssue({ code: 'custom', message: 'Authentication paths must be trusted read-only UED URLs.' }); }
  }
  if (new Set(adapter.pages.map(page => page.key)).size !== adapter.pages.length) {
    ctx.addIssue({ code: 'custom', message: 'Page keys must be unique.' });
  }
  if (!!adapter.auth.captchaInputSelector !== !!adapter.auth.captchaImageSelector) {
    ctx.addIssue({ code: 'custom', message: 'CAPTCHA input and image selectors must be configured together.' });
  }
});
export type UedAdapter = z.infer<typeof uedAdapterSchema>;
export type UedPageMapping = UedAdapter['pages'][number];

export const uedTermSchema = z.object({
  academicYear: z.coerce.string().regex(/^\d{4}$/),
  semester: z.coerce.string().regex(/^[1-3]$/),
}).strict();
export type UedTerm = z.infer<typeof uedTermSchema>;
export interface UedTermOption { value: string; label: string }
export interface UedTermChoices {
  academicYears: UedTermOption[];
  semesters: UedTermOption[];
  selected: UedTerm;
  current: UedTerm;
}

/** The global portal banner identifies the live semester independently of a
 * student's previously selected timetable filter. Fail closed if it changes. */
export function mapUedCurrentTerm(banners: string[]): UedTerm {
  const terms = banners.flatMap(text => {
    const match = /^Hệ:.*?\bNH:\s*(\d{4})-(\d{4})\s+HK:\s*([1-3])$/u.exec(text.replace(/\s+/g, ' ').trim());
    if (!match || Number(match[2]) !== Number(match[1]) + 1) return [];
    return [{ academicYear: match[1], semester: match[3] }];
  });
  if (terms.length !== 1) throw new ApiError(502, 'UED_CURRENT_TERM_MAPPING_FAILED');
  return terms[0];
}
export interface UedWeekRange { week: number; startsOn: string; endsOn: string; label: string }

/** Week labels are read from the portal's weekly-view select, never calculated
 * from an assumed semester start. Only complete, valid date ranges are used. */
export function mapUedWeekRanges(options: UedTermOption[]): UedWeekRange[] {
  const seen = new Set<number>();
  return options.map(option => {
    const matched = /^Tuần\s+(\d+)\s*\((\d{2}-\d{2}-\d{4})\s+đến\s+(\d{2}-\d{2}-\d{4})\)$/iu.exec(option.label.trim());
    if (!matched || matched[1] !== option.value) throw new ApiError(502, 'UED_WEEK_MAPPING_FAILED');
    const start = parse(matched[2], 'dd-MM-yyyy', new Date(2000, 0, 1));
    const end = parse(matched[3], 'dd-MM-yyyy', new Date(2000, 0, 1));
    const week = Number(option.value);
    const startUtc = new Date(`${format(start, 'yyyy-MM-dd')}T00:00:00.000Z`);
    const endUtc = new Date(`${format(end, 'yyyy-MM-dd')}T00:00:00.000Z`);
    if (!Number.isSafeInteger(week) || week < 1 || week > 60 || seen.has(week)
      || !isValid(start) || !isValid(end) || format(start, 'dd-MM-yyyy') !== matched[2]
      || format(end, 'dd-MM-yyyy') !== matched[3] || startUtc.getUTCDay() !== 1 || endUtc.getUTCDay() !== 0
      || +endUtc - +startUtc !== 6 * 86_400_000) throw new ApiError(502, 'UED_WEEK_MAPPING_FAILED');
    seen.add(week);
    return { week, startsOn: format(start, 'yyyy-MM-dd'), endsOn: format(end, 'yyyy-MM-dd'), label: option.label };
  });
}

// Verified from an authenticated student browser on 2026-09-13. This profile
// URL exposes an editor, but the adapter only reads disabled identity + name.
// No profile form is submitted. Academic mappings are added only when observed.
export const verifiedUedDefaults = {
  version: 1,
  timezone: 'Asia/Ho_Chi_Minh',
  auth: {
    identityPath: '/sinhvien/thongtinsinhvien', landingPaths: ['/sinhvien'],
    authenticatedSelector: '#txt_Sua_ma_sinh_vien:disabled',
    studentIdSelector: '#txt_Sua_ma_sinh_vien', studentIdAttribute: 'value',
    nameSelector: '#txt_Sua_ho_ten_sinh_vien', nameAttribute: 'value',
  },
  pages: [{
    // A direct GET is a print rendering. The interactive page is available
    // only by entering through this observed home-menu item.
    key: 'timetable', path: '/sinhvien/thoikhoabieu',
    entry: { path: '/sinhvien', selector: '#thoikhoabieu' },
    title: 'Thời khóa biểu', category: 'SCHEDULE',
    readySelector: '#tb_index',
    // The first cell is a th; the other nine are td. Avoid header/summary rows.
    rowSelector: '#tb_index > tbody > tr:has(> th):has(> td:nth-child(10))',
    idField: 'courseCode', titleField: 'title',
    identityFields: ['courseCode', 'group', 'weekday', 'session', 'periods', 'weeks'],
    termFilter: 'UED_TIMETABLE',
    fields: {
      weekday: { selector: ':scope > :nth-child(1)' }, courseCode: { selector: ':scope > :nth-child(2)' },
      group: { selector: ':scope > :nth-child(3)' }, capacity: { selector: ':scope > :nth-child(4)' },
      title: { selector: ':scope > :nth-child(5)' }, session: { selector: ':scope > :nth-child(6)' },
      periods: { selector: ':scope > :nth-child(7)' }, teacher: { selector: ':scope > :nth-child(8)' },
      location: { selector: ':scope > :nth-child(9)' }, weeks: { selector: ':scope > :nth-child(10)' },
    },
  }],
};

/** Only an operator-controlled same-origin path may ever be visited. */
export function trustedUedUrl(path: string): string {
  const url = new URL(path, UED_ORIGIN);
  if (url.origin !== UED_ORIGIN || url.username || url.password || url.hash || !path.startsWith('/') || path.startsWith('//')) {
    throw new ApiError(400, 'UED_UNTRUSTED_URL');
  }
  // This exact page is the observed read-only list of teacher absences/makeup
  // classes. Its name contains "dangky", but no registration action is allowed.
  const reviewedReadPath = url.pathname === '/sinhvien/thoikhoabieu/dangkynghidaybu';
  const decoded = decodeURIComponent(`${reviewedReadPath ? '' : url.pathname}${url.search}`).toLowerCase();
  if (/(?:logout|log-out|dang[-_]?xuat|delete|remove|insert|update|save|submit|register|dang[-_]?ky|payment|thanh[-_]?toan|doi[-_]?mat[-_]?khau)/i.test(decoded)) {
    throw new ApiError(400, 'UED_MUTATING_URL_BLOCKED');
  }
  return url.href;
}

export function getUedAdapter(): UedAdapter {
  try { return uedAdapterSchema.parse(process.env.UED_ADAPTER_JSON ? JSON.parse(process.env.UED_ADAPTER_JSON) : verifiedUedDefaults); }
  catch { throw new ApiError(503, 'UED_MAPPING_INVALID'); }
}

export function uedReadiness() {
  try {
    const adapter = getUedAdapter();
    return { configured: true, loginReady: true, syncReady: adapter.pages.length > 0,
      categories: [...new Set(adapter.pages.map(page => page.category))], reason: null };
  } catch (error) {
    return { configured: false, loginReady: false, syncReady: false, categories: [],
      reason: error instanceof ApiError ? error.code : 'UED_MAPPING_INVALID' };
  }
}

export interface UedSchedule {
  externalId: string; title: string; startTime: string; endTime: string;
  location: string | null; eventType: 'CLASS' | 'DEADLINE'; cancelled: boolean;
}
export interface UedRecord {
  externalId: string; category: string; title: string;
  fields: Record<string, string>; pageKey: string; schedule?: UedSchedule; term?: UedTerm;
}

function parsePortalDate(value: string, pattern: string, timezone: string): string {
  // Explicit offsets can be used by mapping a genuine ISO field. Other formats
  // must round-trip both calendar fields and timezone; JS Date normalization is rejected.
  if (pattern === 'ISO') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('INVALID_DATE');
    const parsed = new Date(value);
    if (!isValid(parsed)) throw new Error('INVALID_DATE');
    const localPart = value.slice(0, 16);
    const offset = value.endsWith('Z') ? '+00:00' : value.slice(-6);
    if (formatInTimeZone(parsed, offset, "yyyy-MM-dd'T'HH:mm") !== localPart) throw new Error('INVALID_DATE');
    return parsed.toISOString();
  }
  const wallTime = parse(value, pattern, new Date(2000, 0, 1));
  if (!isValid(wallTime) || format(wallTime, pattern) !== value) throw new Error('INVALID_DATE');
  const utc = fromZonedTime(wallTime, timezone);
  if (!isValid(utc) || formatInTimeZone(utc, timezone, pattern) !== value) throw new Error('INVALID_DATE');
  return utc.toISOString();
}

/** Pure mapper: invalid/ambiguous rows abort sync instead of producing invented events. */
export function mapUedRows(rows: Record<string, string>[], mapping: UedPageMapping, timezone: string, term?: UedTerm): UedRecord[] {
  const seen = new Set<string>();
  return rows.map(raw => {
    const fields = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value.replace(/\s+/g, ' ').trim()]));
    const id = fields[mapping.idField];
    const title = fields[mapping.titleField];
    if (!id || id.length > 512 || !title || title.length > 255) throw new ApiError(502, 'UED_INVALID_ROW');
    const identities = mapping.identityFields?.map(field => fields[field]);
    if (identities?.some(value => !value || value.length > 512)) throw new ApiError(502, 'UED_INVALID_ROW');
    const identity = identities ? JSON.stringify(identities) : id;
    // Retain historical semesters instead of overwriting the same course ID.
    const externalId = hash(`${mapping.key}:${term ? `${term.academicYear}:${term.semester}:` : ''}${identity}`);
    if (seen.has(externalId)) throw new ApiError(502, 'UED_DUPLICATE_ROW');
    seen.add(externalId);
    const result: UedRecord = { externalId, category: mapping.category, title, fields, pageKey: mapping.key, ...(term ? { term } : {}) };
    if (mapping.schedule) {
      const map = mapping.schedule;
      try {
        const startTime = parsePortalDate(fields[map.startField] || '', map.dateTimeFormat, timezone);
        const endTime = parsePortalDate(fields[map.endField] || '', map.dateTimeFormat, timezone);
        const eventTitle = fields[map.titleField];
        const location = map.locationField ? fields[map.locationField] || null : null;
        if (!eventTitle || eventTitle.length > 255 || (location && location.length > 255) || +new Date(endTime) <= +new Date(startTime)) throw new Error('INVALID_EVENT');
        result.schedule = { externalId, title: eventTitle, startTime, endTime, location, eventType: map.eventType,
          cancelled: !!map.cancelledField && map.cancelledValues.some(value => value.toLocaleLowerCase() === fields[map.cancelledField!]?.toLocaleLowerCase()) };
      } catch { throw new ApiError(502, 'UED_SCHEDULE_MAPPING_FAILED', `Cannot safely interpret schedule on page ${mapping.key}.`); }
    }
    return result;
  });
}
