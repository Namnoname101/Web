import { describe, expect, it } from 'vitest';
import { agendaDayBounds } from '../../src/modules/scheduling/agenda-overview.js';

describe('agenda local-day boundaries', () => {
  it('uses the student timezone for a normal local day', () => {
    const bounds = agendaDayBounds(new Date('2026-09-14T05:00:00.000Z'), 'Asia/Ho_Chi_Minh');
    expect(bounds.localDate).toBe('2026-09-14');
    expect(bounds.dayStart.toISOString()).toBe('2026-09-13T17:00:00.000Z');
    expect(bounds.dayEnd.toISOString()).toBe('2026-09-14T17:00:00.000Z');
  });

  it('constructs the 23-hour daylight-saving transition day correctly', () => {
    const bounds = agendaDayBounds(new Date('2026-03-08T16:00:00.000Z'), 'America/New_York');
    expect(bounds.localDate).toBe('2026-03-08');
    expect((+bounds.dayEnd - +bounds.dayStart) / 3_600_000).toBe(23);
  });

  it('constructs the 25-hour daylight-saving transition day correctly', () => {
    const bounds = agendaDayBounds(new Date('2026-11-01T16:00:00.000Z'), 'America/New_York');
    expect(bounds.localDate).toBe('2026-11-01');
    expect((+bounds.dayEnd - +bounds.dayStart) / 3_600_000).toBe(25);
  });
});
