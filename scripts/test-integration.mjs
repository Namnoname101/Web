import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const url = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
if (!process.env.TEST_DATABASE_URL) url.pathname = '/personal_schedule_test';
if (!url.pathname.endsWith('_test')) throw new Error('Integration tests require a database name ending in _test.');
const env = { ...process.env, DATABASE_URL:url.toString(), NODE_ENV:'test', DEMO_ENABLED:'true' };
for (const args of [
  ['run','db:deploy','--workspace','@personal-schedule/database'],
  ['exec','--workspace','@personal-schedule/api','--','vitest','run','tests/integration'],
]) {
  const child = spawnSync(process.execPath, [process.env.npm_execpath, ...args], { env, stdio:'inherit', windowsHide:true });
  if (child.status !== 0) process.exit(child.status || 1);
}
