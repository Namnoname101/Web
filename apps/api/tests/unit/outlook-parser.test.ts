import { describe, expect, it } from 'vitest';
import { parseScheduleEmail, readableMail, type MailEvent, type MailMessage } from '../../src/modules/integrations/outlook/email-parser.js';

const timezone = 'Asia/Ho_Chi_Minh';
const event: MailEvent = { id: 'math-1', title: 'Giải tích 1', startTime: new Date('2026-09-14T01:00:00Z'),
  endTime: new Date('2026-09-14T03:00:00Z'), location: 'A101', updatedAt: new Date('2026-09-10T01:00:00Z') };
const english: MailEvent = { ...event, id: 'physics-1', title: 'Physics 1' };
const mail = (subject: string, body = ''): MailMessage => ({ id: 'mail-1', subject,
  body: { contentType: 'text', content: body }, receivedDateTime: '2026-09-13T07:00:00Z',
  from: { emailAddress: { address: 'lecturer@ued.udn.vn' } } });

describe('bilingual Outlook schedule parser', () => {
  it('proposes a Vietnamese cancellation only for the exact class and full date', () => {
    const proposal = parseScheduleEmail(mail('Thông báo nghỉ học Giải tích 1', 'Lớp Giải tích 1 ngày 14/09/2026 nghỉ học.'), [event], timezone);
    expect(proposal).toMatchObject({ action: 'CANCEL', eventId: event.id, expectedUpdatedAt: event.updatedAt.toISOString(),
      evidence: { source: 'OUTLOOK', sender: 'lecturer@ued.udn.vn' } });
  });
  it('parses English cancellation with an explicit month name', () => {
    const proposal = parseScheduleEmail(mail('Physics 1 cancelled', 'Physics 1 on September 14, 2026 is cancelled.'), [english], timezone);
    expect(proposal?.action).toBe('CANCEL');
  });
  it('converts an explicit moved date and time to UTC in the student timezone', () => {
    const proposal = parseScheduleEmail(mail('Đổi lịch Giải tích 1',
      'Giải tích 1 từ ngày 14/09/2026 08:00-10:00 chuyển sang ngày 15/09/2026 13:00-15:00.'), [event], timezone);
    expect(proposal).toMatchObject({ action: 'UPDATE', eventId: event.id,
      changes: { startTime: '2026-09-15T06:00:00.000Z', endTime: '2026-09-15T08:00:00.000Z' } });
  });
  it('parses explicit English AM/PM rescheduling without guessing AM/PM', () => {
    const proposal = parseScheduleEmail(mail('Physics 1 rescheduled',
      'Physics 1 on September 14, 2026, 8am-10am is rescheduled to September 15, 2026, 1pm-3pm.'), [english], timezone);
    expect(proposal?.changes).toEqual({ startTime: '2026-09-15T06:00:00.000Z', endTime: '2026-09-15T08:00:00.000Z' });
  });
  it('uses the new room rather than the old room', () => {
    const proposal = parseScheduleEmail(mail('Đổi phòng Giải tích 1',
      'Lớp Giải tích 1 ngày 14/09/2026. Phòng cũ: A101. Phòng mới: B203.'), [event], timezone);
    expect(proposal).toMatchObject({ action: 'UPDATE', changes: { location: 'B203' } });
  });
  it('does not guess a date or year from tomorrow or a date without a year', () => {
    for (const when of ['ngày mai', 'ngày 14/09']) {
      expect(parseScheduleEmail(mail('Giải tích 1 nghỉ học', `Giải tích 1 ${when} nghỉ học.`), [event], timezone)?.action).toBe('REVIEW');
    }
  });
  it('does not accept impossible dates or ambiguous English numeric dates', () => {
    expect(parseScheduleEmail(mail('Giải tích 1 nghỉ học', 'Ngày 31/02/2026 nghỉ học.'), [event], timezone)?.action).toBe('REVIEW');
    expect(parseScheduleEmail(mail('Physics 1 cancelled', 'Physics 1 on 09/10/2026 is cancelled.'), [english], timezone)?.action).toBe('REVIEW');
  });
  it('keeps negated, hypothetical, and multi-class messages review-only', () => {
    for (const text of ['Physics 1 is not cancelled on September 14, 2026.',
      'If the class is cancelled: Physics 1 on September 14, 2026.']) {
      expect(parseScheduleEmail(mail('Physics 1 schedule', text), [english], timezone)?.action).toBe('REVIEW');
    }
    expect(parseScheduleEmail(mail('Giải tích 1 và Physics 1 nghỉ học ngày 14/09/2026'), [event, english], timezone)?.action).toBe('REVIEW');
  });
  it('does not pick the first of multiple same-day matches without exact time evidence', () => {
    const later = { ...event, id: 'math-2', startTime: new Date('2026-09-14T06:00:00Z'), endTime: new Date('2026-09-14T08:00:00Z') };
    expect(parseScheduleEmail(mail('Giải tích 1 ngày 14/09/2026 nghỉ học'), [event, later], timezone)?.action).toBe('REVIEW');
    expect(parseScheduleEmail(mail('Giải tích 1 nghỉ học', 'Ngày 14/09/2026 13:00-15:00 nghỉ học.'), [event, later], timezone)?.eventId).toBe(later.id);
  });
  it('does not match a partial course title such as Physics 1 against Physics 10', () => {
    const proposal = parseScheduleEmail(mail('Physics 10 class cancelled on September 14, 2026'), [english], timezone);
    expect(proposal).toMatchObject({ action: 'REVIEW', candidateEventIds: [] });
  });
  it('discards HTML markup and quoted old correspondence, with bounded evidence', () => {
    const message: MailMessage = { ...mail('Giải tích 1 nghỉ học ngày 14/09/2026'),
      body: { contentType: 'html', content: '<p>Thông báo mới</p><script>alert(1)</script><blockquote>old cancellation</blockquote>' } };
    expect(readableMail(message)).not.toMatch(/alert|script|old cancellation/);
    expect(parseScheduleEmail(mail('Giải tích 1 nghỉ học ngày 14/09/2026', 'x'.repeat(4000)), [event], timezone)?.evidence.excerpt.length).toBe(600);
    expect(readableMail(mail('Re: schedule', 'Thank you\nOn Thursday, lecturer wrote:\nClass cancelled'))).not.toContain('cancelled');
  });
  it('ignores drafts and unrelated messages', () => {
    expect(parseScheduleEmail({ ...mail('Giải tích 1 nghỉ học ngày 14/09/2026'), isDraft: true }, [event], timezone)).toBeNull();
    expect(parseScheduleEmail(mail('Your weekly newsletter', 'Welcome back!'), [event], timezone)).toBeNull();
    expect(parseScheduleEmail(mail('Your order was cancelled on September 14, 2026'), [event], timezone)).toBeNull();
  });
  it('does not turn historical mailbox notices into current review work', () => {
    const now = new Date('2026-09-14T05:00:00.000Z');
    expect(parseScheduleEmail(mail('Giải tích 1 nghỉ học', 'Lớp Giải tích 1 ngày 01/09/2026 nghỉ học.'), [event], timezone, now)).toBeNull();
    expect(parseScheduleEmail({ ...mail('Giải tích 1 nghỉ học ngày mai'), receivedDateTime: '2026-08-01T00:00:00.000Z' }, [event], timezone, now)).toBeNull();
  });
  it('does not accept explicit time evidence contradicting the only calendar event', () => {
    const proposal = parseScheduleEmail(mail('Giải tích 1 nghỉ học', 'Ngày 14/09/2026 13:00-15:00 nghỉ học.'), [event], timezone);
    expect(proposal?.action).toBe('REVIEW');
  });
  it('does not guess explicit foreign timezones or treat questions as definite changes', () => {
    for (const body of ['Giải tích 1 ngày 14/09/2026 nghỉ học?', 'Giải tích 1 ngày 14/09/2026 08:00-10:00 UTC nghỉ học.']) {
      expect(parseScheduleEmail(mail('Giải tích 1', body), [event], timezone)?.action).toBe('REVIEW');
    }
  });
  it('never invents a new duration when a reschedule lacks an explicit time range', () => {
    expect(parseScheduleEmail(mail('Giải tích 1 đổi lịch',
      'Ngày 14/09/2026 chuyển sang ngày 15/09/2026 lúc 13:00.'), [event], timezone)?.action).toBe('REVIEW');
  });
});
