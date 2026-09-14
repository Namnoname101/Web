import { describe, expect, it } from 'vitest';
import { ApiError, calendarRollover, errorMessage, localDay } from './lib';

describe('calendar day rollover', () => {
  it('calculates today in the student timezone from an explicit instant', () => {
    const instant = Date.parse('2026-09-13T17:00:00.000Z');
    expect(localDay('Asia/Ho_Chi_Minh', instant)).toBe('2026-09-14');
    expect(localDay('UTC', instant)).toBe('2026-09-13');
  });

  it('moves the selected week when the student was following today', () => {
    expect(calendarRollover('2026-09-13', '2026-09-14', '2026-09-07', '2026-09-13')).toEqual({
      week: '2026-09-14',
      selectedDay: '2026-09-14',
    });
  });

  it('preserves a deliberately browsed day when midnight passes', () => {
    expect(calendarRollover('2026-09-13', '2026-09-14', '2026-09-07', '2026-09-10')).toBeNull();
  });
});

describe('API error copy', () => {
  it('shows actionable bilingual conflict and OAuth messages', () => {
    expect(errorMessage(new ApiError('conflict', 409, 'UNSCHEDULE_FIRST'), 'vi')).toContain('bỏ các phiên học tương lai');
    expect(errorMessage(new ApiError('failed', 400, 'OAUTH_STATE_INVALID'), 'en')).toContain('Microsoft sign-in session');
  });
});
