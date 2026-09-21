import { assertConfig } from './config.js';
import { startWorkerLoop } from './jobs/worker-loop.js';
import { shutdownUed } from './modules/integrations/ued/browser.js';
import { getPrismaClient } from '@personal-schedule/database';
import { createShutdownCoordinator } from './lib/graceful-shutdown.js';
assertConfig();
const stop = startWorkerLoop();
const keepAlive = setInterval(() => {}, 60_000);
console.info('Student planner worker started.');
const shutdown = createShutdownCoordinator({
  label: 'student planner worker',
  phases: [
    [{ name: 'worker-loop', run: async () => { clearInterval(keepAlive); await stop(); } }],
    [{ name: 'ued-browser', run: shutdownUed }],
    [{ name: 'database', run: () => getPrismaClient().$disconnect() }],
  ],
});
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
