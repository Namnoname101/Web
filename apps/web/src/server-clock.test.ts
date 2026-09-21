import { describe, expect, it } from 'vitest';
import { ServerClock } from './server-clock';

describe('server time', () => {
  it('ignores a wrong device date and later device clock jumps', () => {
    const clock = new ServerClock();
    const epoch = Date.parse('2026-09-15T05:00:00Z');
    clock.synchronize('2026-09-15T05:00:00Z', 100, 200);
    expect(clock.now(200, 0)).toBe(epoch + 50);
    expect(clock.now(1200, 9_999_999_999_999)).toBe(epoch + 1050);
  });
  it('keeps its last valid time when synchronization is invalid', () => {
    const clock = new ServerClock();
    expect(clock.now(50, 1000)).toBe(1000);
    clock.synchronize('2026-09-15T05:00:00Z', 100, 200);
    expect(clock.synchronize('invalid', 200, 300)).toBe(false);
    expect(clock.now(300)).toBe(Date.parse('2026-09-15T05:00:00Z') + 150);
  });
});
