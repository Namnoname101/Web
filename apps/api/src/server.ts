import { app } from './app.js';
import { assertConfig, config } from './config.js';
import { getPrismaClient } from '@personal-schedule/database';
import { startWorkerLoop } from './jobs/worker-loop.js';
import { shutdownUed } from './modules/integrations/ued/browser.js';

assertConfig();
const port = config.port;
const stopWorker = process.env.WORKER_ENABLED === 'true' ? startWorkerLoop() : async () => {};

const server = app.listen(port, () => {
  console.info(`API listening on http://localhost:${port}`);
});

function shutdown(signal: string): void {
  console.info(`${signal} received; stopping API server.`);
  server.close(async (error) => {
    await stopWorker();
    await shutdownUed();
    await getPrismaClient().$disconnect();
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
