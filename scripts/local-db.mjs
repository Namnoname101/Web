import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = process.env.PG_BIN || 'E:/PostgreSQL/18/bin';
const exe = name => path.join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
if (!existsSync(exe('initdb'))) throw new Error('Set PG_BIN to the PostgreSQL bin directory, or use docker compose.');
const dir = path.join(root, '.local/postgres');
const envFile = path.join(root, '.env');
await mkdir(path.join(root, '.tmp'), { recursive: true });
await mkdir(path.join(root, '.local'), { recursive: true });
const env = { ...process.env, TEMP: path.join(root, '.tmp'), TMP: path.join(root, '.tmp'), TMPDIR: path.join(root, '.tmp') };
let password;
if (!existsSync(envFile)) {
  password = randomBytes(24).toString('hex');
  await writeFile(envFile, `NODE_ENV=development\nPORT=3000\nWEB_ORIGIN=http://localhost:5173\nDATABASE_URL=postgresql://schedule:${password}@127.0.0.1:55432/personal_schedule\nENCRYPTION_KEY=${randomBytes(32).toString('base64')}\nDEMO_ENABLED=true\nMICROSOFT_TENANT_ID=organizations\nMICROSOFT_CLIENT_ID=\nMICROSOFT_CLIENT_SECRET=\nMICROSOFT_REDIRECT_URI=http://localhost:3000/api/v1/auth/microsoft/callback\nUED_BASE_URL=https://qlht.ued.udn.vn/\n`, { flag: 'wx', mode: 0o600 });
} else {
  const content = await readFile(envFile, 'utf8');
  const value = content.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
  if (!value) throw new Error('Existing .env needs DATABASE_URL.');
  const url = new URL(value);
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.username !== 'schedule') throw new Error('Existing .env uses a different database; it was preserved.');
  password = decodeURIComponent(url.password);
}
const run = (name, args) => execFileSync(exe(name), args, { env, cwd: root, windowsHide: true, stdio: 'pipe' });
if (!existsSync(path.join(dir, 'PG_VERSION'))) {
  const pwFile = path.join(root, '.tmp/postgres-bootstrap-password');
  await writeFile(pwFile, password, { flag: 'wx', mode: 0o600 });
  try { run('initdb', ['-D', dir, '-U', 'schedule', '--auth=scram-sha-256', `--pwfile=${pwFile}`, '--encoding=UTF8', '--locale=C']); }
  finally { await unlink(pwFile); }
}
let running = false;
try { run('pg_ctl', ['-D', dir, 'status']); running = true; } catch { /* start isolated cluster */ }
if (!running) execFileSync(exe('pg_ctl'), ['-D', dir, '-l', path.join(root, '.local/postgres.log'), '-o', '-p 55432 -h 127.0.0.1', '-w', 'start'], { env, cwd: root, windowsHide: true, stdio: 'ignore' });
env.PGPASSWORD = password;
for (const db of ['personal_schedule', 'personal_schedule_test']) {
  const found = run('psql', ['-h', '127.0.0.1', '-p', '55432', '-U', 'schedule', '-d', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname='${db}'`]).toString().trim();
  if (!found) run('createdb', ['-h', '127.0.0.1', '-p', '55432', '-U', 'schedule', db]);
}
console.log('Local PostgreSQL ready at 127.0.0.1:55432. Data and generated .env are stored in this workspace.');
