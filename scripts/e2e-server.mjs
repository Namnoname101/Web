import { config as loadEnvironment } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
loadEnvironment({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const database = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
if (!process.env.TEST_DATABASE_URL) database.pathname = '/personal_schedule_test';
if (!database.pathname.endsWith('_test')) {
  throw new Error('Browser tests require an isolated database name ending in _test.');
}

Object.assign(process.env, {
  DATABASE_URL: database.toString(),
  NODE_ENV: 'test',
  DEMO_ENABLED: 'true',
  WORKER_ENABLED: 'false',
  PORT: '3100',
  WEB_ORIGIN: 'http://127.0.0.1:3100',
});

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is unavailable. Start E2E through npm run test:e2e.');
const migration = spawnSync(process.execPath, [npmCli, 'run', 'db:deploy', '--workspace', '@personal-schedule/database'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});
if (migration.status !== 0) process.exit(migration.status || 1);

// Configuration must be established before importing the compiled application.
const [{ app }, { assertConfig }, { getPrismaClient }, { shutdownUed }] = await Promise.all([
  import('../apps/api/dist/app.js'),
  import('../apps/api/dist/config.js'),
  import('../packages/database/dist/index.js'),
  import('../apps/api/dist/modules/integrations/ued/browser.js'),
]);
assertConfig();
// This deletion is intentionally fenced by the `_test` database check above.
// Cascades remove only demo fixtures from earlier browser runs.
await getPrismaClient().user.deleteMany({ where: { isDemo: true } });

// Playwright normally force-kills its web server. That can be denied in a
// restricted Windows runner, so global teardown requests a cooperative exit.
// This route exists only in this isolated test process, never in the real API.
app.post('/__e2e__/shutdown', (_request, response) => {
  response.status(202).end();
  response.once('finish', () => setImmediate(shutdownAndExit));
});

const server = app.listen(3100, '127.0.0.1', () => {
  console.info('Isolated E2E server listening on http://127.0.0.1:3100');
});

let closing;
async function close() {
  if (closing) return closing;
  closing = (async () => {
    const serverClosed = new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      // Browser contexts can leave idle keep-alive sockets behind briefly.
      // They carry no state and must not make a completed E2E suite hang.
      server.closeAllConnections();
    });
    await Promise.all([serverClosed, shutdownUed()]);
    await getPrismaClient().$disconnect();
  })();
  return closing;
}

function shutdownAndExit() {
  const deadline = setTimeout(() => {
    console.error('E2E server shutdown timed out.');
    process.exit(1);
  }, 10_000);
  void close().then(
    () => { clearTimeout(deadline); process.exit(0); },
    error => { clearTimeout(deadline); console.error('E2E server shutdown failed.', error); process.exit(1); },
  );
}
process.once('SIGINT', shutdownAndExit);
process.once('SIGTERM', shutdownAndExit);
