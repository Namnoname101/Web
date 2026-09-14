import { assertConfig } from './config.js';
import { startWorkerLoop } from './jobs/worker-loop.js';
import { shutdownUed } from './modules/integrations/ued/browser.js';
import { getPrismaClient } from '@personal-schedule/database';
assertConfig();
const stop = startWorkerLoop();
const keepAlive = setInterval(() => {}, 60_000);
console.info('Student planner worker started.');
async function shutdown() { clearInterval(keepAlive); await stop(); await shutdownUed(); await getPrismaClient().$disconnect(); }
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
