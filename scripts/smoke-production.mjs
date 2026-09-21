import { config as loadEnvironment } from 'dotenv';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

loadEnvironment({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Production smoke requires TEST_DATABASE_URL or DATABASE_URL.');
}
const database = new URL(databaseUrl);
if (!process.env.TEST_DATABASE_URL) database.pathname = '/personal_schedule_test';
if (!database.pathname.endsWith('_test')) {
  throw new Error('Production smoke requires an isolated database name ending in _test.');
}

// Exercise production-only validation, secure headers and static serving while
// remaining completely isolated from external integrations and real records.
Object.assign(process.env, {
  DATABASE_URL: database.toString(),
  NODE_ENV: 'production',
  PORT: '3201',
  WEB_ORIGIN: 'https://planner.example.test',
  DEMO_ENABLED: 'false',
  WORKER_ENABLED: 'false',
  TRUST_PROXY_HOPS: '1',
  MICROSOFT_CLIENT_ID: '',
  MICROSOFT_CLIENT_SECRET: '',
  MICROSOFT_TENANT_ID: 'organizations',
  MICROSOFT_REDIRECT_URI: 'https://planner.example.test/api/v1/auth/microsoft/callback',
});

const [{ app }, { assertConfig }, { getPrismaClient }, { shutdownUed }] = await Promise.all([
  import('../apps/api/dist/app.js'),
  import('../apps/api/dist/config.js'),
  import('../packages/database/dist/index.js'),
  import('../apps/api/dist/modules/integrations/ued/browser.js'),
]);
assertConfig();

const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Production smoke server did not expose a TCP address.');
const origin = `http://127.0.0.1:${address.port}`;

async function request(path) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}.`);
  return response;
}

try {
  const health = await (await request('/api/v1/health')).json();
  const ready = await (await request('/api/v1/ready')).json();
  const page = await request('/');
  const html = await page.text();
  if (health.status !== 'ok' || ready.status !== 'ready') throw new Error('Health/readiness payload is invalid.');
  if (!html.includes('<div id="root"></div>')) throw new Error('Production React entry point is missing.');
  if (page.headers.has('x-powered-by')) throw new Error('Express implementation header must stay disabled.');
  if (!page.headers.get('content-security-policy')) throw new Error('Production security headers are missing.');
  console.info('Production smoke passed: config, database, security headers, and React static entry point.');
} finally {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  await shutdownUed();
  await getPrismaClient().$disconnect();
}
