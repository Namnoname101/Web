import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHttpDrainStep,
  createShutdownCoordinator,
  shutdownErrorSummary,
  type ClosableHttpServer,
  type ShutdownLogger,
} from '../../src/lib/graceful-shutdown.js';

const logger = (): ShutdownLogger => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

afterEach(() => vi.useRealTimers());

describe('graceful shutdown', () => {
  it('is idempotent and preserves sequential cleanup phases', async () => {
    const first = deferred();
    const order: string[] = [];
    const shutdown = createShutdownCoordinator({
      label: 'test service',
      phases: [
        [{ name: 'first', run: async () => { order.push('first'); await first.promise; } }],
        [{ name: 'second', run: async () => { order.push('second'); } }],
      ],
      logger: logger(),
      forceExit: vi.fn(),
    });

    const original = shutdown('SIGTERM');
    const repeated = shutdown('SIGINT');
    expect(repeated).toBe(original);
    await vi.waitFor(() => expect(order).toEqual(['first']));
    first.resolve();
    await original;
    expect(order).toEqual(['first', 'second']);
  });

  it('continues later cleanup after a step fails and reports only safe metadata', async () => {
    const log = logger();
    const setExitCode = vi.fn();
    const order: string[] = [];
    const secret = new Error('SQL and token must never reach logs') as Error & { code: string };
    secret.code = 'DB_UNAVAILABLE';
    const shutdown = createShutdownCoordinator({
      label: 'test service',
      phases: [
        [{ name: 'worker', run: async () => { throw secret; } }],
        [{ name: 'browser', run: async () => { order.push('browser'); } }],
        [{ name: 'database', run: async () => { order.push('database'); } }],
      ],
      logger: log,
      setExitCode,
      forceExit: vi.fn(),
    });

    await shutdown('SIGTERM');
    expect(order).toEqual(['browser', 'database']);
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(JSON.stringify((log.error as ReturnType<typeof vi.fn>).mock.calls)).toContain('DB_UNAVAILABLE');
    expect(JSON.stringify((log.error as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(secret.message);
  });

  it('forces termination when the hard deadline is exceeded', async () => {
    vi.useFakeTimers();
    const forceExit = vi.fn();
    const forcedCleanup = vi.fn();
    const shutdown = createShutdownCoordinator({
      label: 'stuck service',
      phases: [[{ name: 'stuck', run: () => new Promise<void>(() => {}) }]],
      hardTimeoutMs: 500,
      logger: logger(),
      onHardTimeout: forcedCleanup,
      setExitCode: vi.fn(),
      forceExit,
    });

    void shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(500);
    expect(forcedCleanup).toHaveBeenCalledOnce();
    expect(forceExit).toHaveBeenCalledWith(1);
  });

  it('drains normally without force-closing active connections', async () => {
    vi.useFakeTimers();
    let callback: ((error?: Error) => void) | undefined;
    const server: ClosableHttpServer = {
      close: vi.fn(cb => { callback = cb; }),
      closeAllConnections: vi.fn(),
    };
    const draining = createHttpDrainStep(server, 500, logger())();
    callback?.();
    await draining;
    await vi.advanceTimersByTimeAsync(500);
    expect(server.close).toHaveBeenCalledOnce();
    expect(server.closeAllConnections).not.toHaveBeenCalled();
  });

  it('force-closes HTTP connections only after the drain deadline', async () => {
    vi.useFakeTimers();
    let callback: ((error?: Error) => void) | undefined;
    const server: ClosableHttpServer = {
      close: vi.fn(cb => { callback = cb; }),
      closeAllConnections: vi.fn(),
    };
    const draining = createHttpDrainStep(server, 500, logger())();
    await vi.advanceTimersByTimeAsync(499);
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    callback?.();
    await draining;
  });

  it('summarizes arbitrary errors without copying their messages', () => {
    expect(shutdownErrorSummary(new Error('private content'))).toEqual({
      name: 'Error',
      code: 'UNEXPECTED_ERROR',
    });
  });
});
