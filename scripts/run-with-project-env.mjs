import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptName = process.argv[2];
if (!scriptName) {
  console.error('Usage: node scripts/run-with-project-env.mjs <npm-script>');
  process.exit(1);
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const projectCache = path.join(projectRoot, '.npm-cache');
const projectTemp = path.join(projectRoot, '.tmp');

await Promise.all([
  mkdir(projectCache, { recursive: true }),
  mkdir(projectTemp, { recursive: true }),
]);

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('npm_execpath is unavailable. Run this through an npm script.');
  process.exit(1);
}

const child = spawn(process.execPath, [npmCli, 'run', scriptName], {
  cwd: projectRoot,
  env: {
    ...process.env,
    TEMP: projectTemp,
    TMP: projectTemp,
    TMPDIR: projectTemp,
    PLAYWRIGHT_BROWSERS_PATH: path.join(projectRoot, '.browsers'),
    npm_config_cache: projectCache,
  },
  stdio: 'inherit',
});

child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
