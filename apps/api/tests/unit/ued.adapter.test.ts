import { describe, expect, it } from 'vitest';
import { getUedAdapter, mapUedCurrentTerm, mapUedRows, mapUedWeekRanges, trustedUedUrl, uedAdapterSchema } from '../../src/modules/integrations/ued/adapter.js';
import { allowedPortalRequest, isPageEntryBody, isTimetableFilterBody } from '../../src/modules/integrations/ued/browser.js';

const adapter = uedAdapterSchema.parse({
  ...getUedAdapter(),
  pages: [{
    key: 'test-schedule', path: '/sinhvien/thoikhoabieu',
    entry: { path: '/sinhvien', selector: '#thoikhoabieu' }, title: 'Schedule', category: 'SCHEDULE',
    readySelector: '#fixture', rowSelector: 'tbody tr', idField: 'id', titleField: 'title',
    fields: { id: { selector: '.id' }, title: { selector: '.title' }, start: { selector: '.start' },
      end: { selector: '.end' }, location: { selector: '.location' }, status: { selector: '.status' } },
    schedule: { titleField: 'title', startField: 'start', endField: 'end', dateTimeFormat: 'dd/MM/yyyy HH:mm',
      locationField: 'location', cancelledField: 'status', cancelledValues: ['Đã hủy'] },
  }],
});
const page = adapter.pages[0];
const sample = { id: 'COURSE-1-2026-09-14', title: 'Giải tích', start: '14/09/2026 07:00', end: '14/09/2026 09:00', location: 'A101', status: 'Học' };

describe('UED live semester marker', () => {
  it('reads the school banner independently of previously selected filters', () => {
    expect(mapUedCurrentTerm(['Unrelated cell', 'Hệ: Đại học\n NH: 2026-2027 HK: 1'])).toEqual({ academicYear: '2026', semester: '1' });
    expect(mapUedCurrentTerm(['Hệ: Đại học NH: 2027-2028 HK: 2'])).toEqual({ academicYear: '2027', semester: '2' });
  });
  it('rejects missing, contradictory or malformed banner dates instead of guessing', () => {
    for (const banners of [[], ['Hệ: Đại học NH: 2026-2028 HK: 1'], ['Hệ: Đại học NH: 2026-2027 HK: 4'],
      ['Hệ: Đại học NH: 2026-2027 HK: 1', 'Hệ: Đại học NH: 2025-2026 HK: 2']]) {
      expect(() => mapUedCurrentTerm(banners)).toThrow('UED_CURRENT_TERM_MAPPING_FAILED');
    }
  });
});

describe('UED URL and request boundary', () => {
  it('accepts only same-origin configured read pages', () => {
    expect(trustedUedUrl('/sinhvien/thoikhoabieu')).toBe('https://qlht.ued.udn.vn/sinhvien/thoikhoabieu');
    for (const value of ['https://attacker.test/', '//attacker.test/', '/sinhvien/delete/1', '/page?action=update', '/x#fragment']) {
      expect(() => trustedUedUrl(value)).toThrow();
    }
  });
  it('allows only the observed absence list, not registration or action variants', () => {
    expect(trustedUedUrl('/sinhvien/thoikhoabieu/dangkynghidaybu')).toBe('https://qlht.ued.udn.vn/sinhvien/thoikhoabieu/dangkynghidaybu');
    for (const path of ['/sinhvien/dangkynghidaybu/save', '/sinhvien/dangkynghidaybu?update=1',
      '/sinhvien/dangkyhocphan', '/sinhvien/dangkynghidaybu%2fsave']) {
      expect(() => trustedUedUrl(path)).toThrow();
    }
  });
  it('permits one explicitly enabled login POST, no other mutation', () => {
    expect(allowedPortalRequest('https://qlht.ued.udn.vn/login/login', 'POST', 'document', true, ['/'])).toBe(true);
    expect(allowedPortalRequest('https://qlht.ued.udn.vn/login/login', 'POST', 'document', false, ['/'])).toBe(false);
    expect(allowedPortalRequest('https://qlht.ued.udn.vn/sinhvien/thongtinsinhvien', 'POST', 'document', true, ['/sinhvien/thongtinsinhvien'])).toBe(false);
    expect(allowedPortalRequest('https://qlht.ued.udn.vn/api/save', 'GET', 'fetch', true, ['/api/save'])).toBe(false);
    expect(allowedPortalRequest('https://attacker.test/steal', 'GET', 'image', true, ['/'])).toBe(false);
  });
  it('allows only the exact reviewed menu POST shape for a page entry', () => {
    const token = `${'a'.repeat(32)}|${'b'.repeat(32)}`, session = 'session-key';
    expect(isPageEntryBody(`pu=${token}&sskey=${session}`)).toBe(true);
    for (const body of [`pu=${'g'.repeat(32)}|${'b'.repeat(32)}&sskey=${session}`, `pu=${token}`, `pu=${token}&sskey=${session}&action=save`,
      `pu=${token}&pu=${token}&sskey=${session}`, `pu=${token}&sskey=${session}&sskey=again`, `pu=short&sskey=${session}`]) expect(isPageEntryBody(body)).toBe(false);
    expect(allowedPortalRequest('https://qlht.ued.udn.vn/sinhvien/thoikhoabieu', 'POST', 'document', false, [],
      undefined, `pu=${token}&sskey=${session}`, { path: '/sinhvien/thoikhoabieu' })).toBe(true);
    expect(allowedPortalRequest('https://qlht.ued.udn.vn/sinhvien/thoikhoabieu', 'POST', 'document', false, [],
      undefined, `pu=${token}&sskey=${session}`, undefined)).toBe(false);
  });
  it('blocks non-reviewed navigation and XHR URLs even on the portal origin', () => {
    expect(allowedPortalRequest('https://qlht.ued.udn.vn/sinhvien/private', 'GET', 'document', false, ['/'])).toBe(false);
    expect(allowedPortalRequest('https://qlht.ued.udn.vn/api/unknown', 'GET', 'xhr', false, ['/'])).toBe(false);
    expect(allowedPortalRequest('https://qlht.ued.udn.vn/assets/app.css', 'GET', 'stylesheet', false, ['/'])).toBe(true);
  });
  it('permits the exact semester filter POST only during that requested read', () => {
    const term = { academicYear: '2025', semester: '2' };
    const body = new URLSearchParams({ cmb_sr_ds_nam_hoc: '2025', cmb_sr_ds_hoc_ky: '2',
      h_app_action: '', h_ds_app_action: '', h_tuychon: '', h_tuan: '', sskey: 'fixture-not-a-session' }).toString();
    const url = 'https://qlht.ued.udn.vn/sinhvien/thoikhoabieu/index';
    expect(allowedPortalRequest(url, 'POST', 'document', false, [], term, body)).toBe(true);
    expect(allowedPortalRequest(url, 'POST', 'document', false, [], undefined, body)).toBe(false);
    expect(allowedPortalRequest(url, 'POST', 'xhr', false, [], term, body)).toBe(false);
    expect(allowedPortalRequest(url + '/save', 'POST', 'document', false, [], term, body)).toBe(false);
    expect(isTimetableFilterBody(body, { ...term, semester: '1' })).toBe(false);
    for (const mutation of ['&btnSave=save', '&action=delete', '&h_app_action=delete', '&cmb_sr_ds_hoc_ky=3']) {
      expect(isTimetableFilterBody(body + mutation, term)).toBe(false);
    }
  });
  it('rejects inconsistent field mappings before opening a browser', () => {
    expect(() => uedAdapterSchema.parse({ ...adapter, pages: [{ ...page, idField: 'missing' }] })).toThrow();
    expect(() => uedAdapterSchema.parse({ ...adapter, pages: [page, page] })).toThrow();
    expect(() => uedAdapterSchema.parse({ ...adapter, auth: { ...adapter.auth, identityPath: '//attacker.test/' } })).toThrow();
  });
});

describe('observed portal week-date labels', () => {
  it('keeps week dates across New Year exactly as displayed', () => {
    expect(mapUedWeekRanges([
      { value: '1', label: 'Tuần 1 (29-12-2025 đến 04-01-2026)' },
      { value: '2', label: 'Tuần 2 (05-01-2026 đến 11-01-2026)' },
    ])).toMatchObject([
      { week: 1, startsOn: '2025-12-29', endsOn: '2026-01-04' },
      { week: 2, startsOn: '2026-01-05', endsOn: '2026-01-11' },
    ]);
  });
  it('rejects invalid or contradictory week values instead of guessing', () => {
    for (const option of [
      { value: '2', label: 'Tuần 1 (29-12-2025 đến 04-01-2026)' },
      { value: '1', label: 'Tuần 1 (31-02-2026 đến 08-03-2026)' },
      { value: '1', label: 'Tuần 1 (12-01-2026 đến 04-01-2026)' },
      { value: '1', label: 'Tuần 1 (13-01-2026 đến 19-01-2026)' },
      { value: '1', label: 'Tuần 1 (12-01-2026 đến 20-01-2026)' },
    ]) expect(() => mapUedWeekRanges([option])).toThrow();
  });
});

describe('validated academic and schedule row mapping', () => {
  it('converts observed full local dates to UTC without depending on server timezone', () => {
    const [record] = mapUedRows([sample], page, 'Asia/Ho_Chi_Minh');
    expect(record.schedule).toMatchObject({ title: 'Giải tích', startTime: '2026-09-14T00:00:00.000Z',
      endTime: '2026-09-14T02:00:00.000Z', location: 'A101', eventType: 'CLASS', cancelled: false });
    expect(record.externalId).toHaveLength(64);
  });
  it('has a stable identity when times change', () => {
    expect(mapUedRows([sample], page, adapter.timezone)[0].externalId).toBe(
      mapUedRows([{ ...sample, start: '14/09/2026 08:00' }], page, adapter.timezone)[0].externalId);
  });
  it('keeps historical semesters separate and identifies several meetings of one course', () => {
    const term = { academicYear: '2025', semester: '2' };
    const multiMeeting = { ...page, identityFields: ['id', 'start'] };
    const first = mapUedRows([sample], multiMeeting, adapter.timezone, term)[0];
    const otherMeeting = mapUedRows([{ ...sample, start: '15/09/2026 07:00', end: '15/09/2026 09:00' }], multiMeeting, adapter.timezone, term)[0];
    const nextTerm = mapUedRows([sample], multiMeeting, adapter.timezone, { ...term, semester: '3' })[0];
    expect(first.term).toEqual(term);
    expect(first.externalId).not.toBe(otherMeeting.externalId);
    expect(first.externalId).not.toBe(nextTerm.externalId);
    expect(mapUedRows([sample], multiMeeting, adapter.timezone, term)[0].externalId).toBe(first.externalId);
  });
  it('rejects impossible dates, incomplete dates, reversed time and duplicate IDs', () => {
    for (const changed of [{ start: '31/02/2026 07:00' }, { start: 'Thứ hai tiết 1' }, { end: '14/09/2026 06:00' }]) {
      expect(() => mapUedRows([{ ...sample, ...changed }], page, adapter.timezone)).toThrow('Cannot safely interpret');
    }
    expect(() => mapUedRows([sample, sample], page, adapter.timezone)).toThrow('UED_DUPLICATE_ROW');
  });
  it('uses cancellation only from explicitly mapped status values', () => {
    expect(mapUedRows([{ ...sample, status: 'Đã hủy' }], page, adapter.timezone)[0].schedule?.cancelled).toBe(true);
    expect(mapUedRows([], page, adapter.timezone)).toEqual([]);
  });
  it('rejects ISO dates that JavaScript would normalize into the next month', () => {
    const isoPage = { ...page, schedule: { ...page.schedule!, dateTimeFormat: 'ISO' } };
    expect(() => mapUedRows([{ ...sample, start: '2026-02-30T07:00:00+07:00', end: '2026-03-02T09:00:00+07:00' }], isoPage, adapter.timezone)).toThrow();
    expect(mapUedRows([{ ...sample, start: '2026-09-14T07:00:00+07:00', end: '2026-09-14T09:00:00+07:00' }], isoPage, adapter.timezone)[0].schedule?.startTime).toBe('2026-09-14T00:00:00.000Z');
  });
});
