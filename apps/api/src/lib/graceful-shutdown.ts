import { safeErrorSummary } from './safe-error.js';

export interface ShutdownLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, detail?: unknown): void;
}

export interface ShutdownStep {
  name: string;
  run: () => Promise<void>;
}

export interface ShutdownCoordinatorOptions {
  label: string;
  /** Phases are sequential; all steps inside one phase run concurrently. */
  phases: ReadonlyArray<ReadonlyArray<ShutdownStep>>;
  hardTimeoutMs?: number;
  onHardTimeout?: () => void;
  logger?: ShutdownLogger;
  setExitCode?: (code: number) => void;
  forceExit?: (code: number) => void;
}

export interface ClosableHttpServer {
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections(): void;
}

/** Never serialize error messages here: they can contain SQL, tokens or student data. */
export const shutdownErrorSummary = safeErrorSummary;

/**
 * Build an idempotent shutdown function. Repeated signals share the same work,
 * every phase is attempted, and a hard deadline prevents an orchestrator from
 * leaving a half-closed instance alive forever.
 */
export function createShutdownCoordinator(options: ShutdownCoordinatorOptions) {
  const logger = options.logger ?? console;
  const hardTimeoutMs = options.hardTimeoutMs ?? 25_000;
  const setExitCode = options.setExitCode ?? (code => { process.exitCode = code; });
  const forceExit = options.forceExit ?? (code => process.exit(code));
  let inFlight: Promise<void> | undefined;

  return (signal: string): Promise<void> => {
    if (inFlight) return inFlight;

    logger.info(`${signal} received; stopping ${options.label}.`);
    let hardTimer: ReturnType<typeof setTimeout>;
    const work = (async () => {
      let failed = false;
      for (const phase of options.phases) {
        const results = await Promise.allSettled(
          phase.map(step => Promise.resolve().then(step.run)),
        );
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            failed = true;
            logger.error(`${options.label} shutdown step failed`, {
              step: phase[index]?.name ?? 'unknown',
              ...shutdownErrorSummary(result.reason),
            });
          }
        });
      }
      if (failed) setExitCode(1);
    })();

    hardTimer = setTimeout(() => {
      logger.error(`${options.label} shutdown exceeded its hard deadline.`);
      try {
        options.onHardTimeout?.();
      } catch (error) {
        logger.error(`${options.label} forced cleanup failed`, shutdownErrorSummary(error));
      }
      setExitCode(1);
      forceExit(1);
    }, hardTimeoutMs);
    hardTimer.unref();

    inFlight = work.finally(() => clearTimeout(hardTimer));
    return inFlight;
  };
}

/** Stop accepting requests immediately, then allow active requests to drain. */
export function createHttpDrainStep(
  server: ClosableHttpServer,
  timeoutMs = 10_000,
  logger: ShutdownLogger = console,
): () => Promise<void> {
  return () => new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      logger.warn('HTTP drain deadline reached; closing active connections.');
      try {
        server.closeAllConnections();
      } catch (error) {
        finish(error instanceof Error ? error : new Error('HTTP_FORCE_CLOSE_FAILED'));
      }
    }, timeoutMs);
    timer.unref();

    try {
      // Calling close before closeAllConnections avoids accepting a new socket
      // between the graceful and forced shutdown operations.
      server.close(finish);
    } catch (error) {
      finish(error instanceof Error ? error : new Error('HTTP_CLOSE_FAILED'));
    }
  });
}
