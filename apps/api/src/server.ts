import { app } from './app.js';
import { assertConfig, config } from './config.js';
import { getPrismaClient } from '@personal-schedule/database';
import { startWorkerLoop } from './jobs/worker-loop.js';
import { shutdownUed } from './modules/integrations/ued/browser.js';
import { createHttpDrainStep, createShutdownCoordinator } from './lib/graceful-shutdown.js';

assertConfig();
const port = config.port;
const stopWorker = process.env.WORKER_ENABLED === 'true' ? startWorkerLoop() : async () => {};

const server = app.listen(port, () => {
  console.info(`API listening on http://localhost:${port}`);
});

const shutdown = createShutdownCoordinator({
  label: 'API server',
  phases: [
    [
      { name: 'http', run: createHttpDrainStep(server) },
      { name: 'worker', run: stopWorker },
    ],
    [{ name: 'ued-browser', run: shutdownUed }],
    [{ name: 'database', run: () => getPrismaClient().$disconnect() }],
  ],
  onHardTimeout: () => server.closeAllConnections(),
});

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
