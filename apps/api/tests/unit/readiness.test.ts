import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReadinessCheck } from '../../src/app.js';

describe('database readiness cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('coalesces concurrent checks and caches successful probes', async () => {
    let release!: () => void;
    const probe = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const check = createReadinessCheck(probe, { successCacheMs: 2_000, failureCacheMs: 5_000, timeoutMs: 1_000 });

    const first = check();
    const second = check();
    await Promise.resolve();
    expect(probe).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);

    await check();
    expect(probe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_001);
    void check();
    await Promise.resolve();
    expect(probe).toHaveBeenCalledTimes(2);
    release();
  });

  it('returns a stable 503 and negative-caches a failed probe', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('connection string and query details'));
    const check = createReadinessCheck(probe, { successCacheMs: 2_000, failureCacheMs: 5_000, timeoutMs: 1_000 });

    await expect(check()).rejects.toMatchObject({ status: 503, code: 'DATABASE_NOT_READY' });
    await expect(check()).rejects.toMatchObject({ status: 503, code: 'DATABASE_NOT_READY' });
    expect(probe).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_001);
    await expect(check()).rejects.toMatchObject({ status: 503, code: 'DATABASE_NOT_READY' });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('bounds callers without piling probes onto a database request that remains hung', async () => {
    let release!: () => void;
    const probe = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const check = createReadinessCheck(probe, { successCacheMs: 2_000, failureCacheMs: 5_000, timeoutMs: 1_000 });

    const first = expect(check()).rejects.toMatchObject({ status: 503, code: 'DATABASE_NOT_READY' });
    await vi.advanceTimersByTimeAsync(1_000);
    await first;
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(check()).rejects.toMatchObject({ status: 503, code: 'DATABASE_NOT_READY' });
    expect(probe).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
    await expect(check()).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
