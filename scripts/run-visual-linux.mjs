// Runs the visual suite inside CI's rendering environment.
//
// `system-ui` — which every canvas string is drawn through — resolves to a
// different font family on each host, and a different family shifts glyph
// metrics far past the suite's 1.5% differing-area cap. The committed baselines
// are therefore captured on CI and can only be reproduced against CI's font
// resolution, not the host's. This wraps that environment in a container so a
// local `npm run test:visual:linux` gives the same verdict CI will.
//
// Extra arguments are forwarded to Playwright:
//   npm run test:visual:linux -- -g "campaign summary"
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function docker(args, options = {}) {
  return spawnSync('docker', args, { cwd: repoRoot, ...options });
}

// Pin the image to the installed Playwright, so the container can never drift
// to a different Chromium than the one `npm test` uses.
let playwrightVersion;
try {
  playwrightVersion = JSON.parse(
    readFileSync(resolve(repoRoot, 'node_modules/@playwright/test/package.json'), 'utf8'),
  ).version;
} catch {
  fail('@playwright/test is not installed. Run `npm ci` first.');
}

const image = `bannerfall-visual:pw${playwrightVersion}`;

if (docker(['version'], { stdio: 'ignore' }).status !== 0) {
  fail('Docker is not available or its daemon is not running. Start Docker, then retry.');
}

if (docker(['image', 'inspect', image], { stdio: 'ignore' }).status !== 0) {
  console.log(`Building ${image} (one-off, a few seconds after the base image is pulled)...`);
  const built = docker([
    'build',
    '--build-arg', `PLAYWRIGHT_VERSION=${playwrightVersion}`,
    '-f', 'scripts/visual-linux.Dockerfile',
    '-t', image,
    '.',
  ], { stdio: 'inherit' });
  if (built.status !== 0) fail(`Could not build ${image}.`);
}

// The base image has python3 but no `python`, so the server is started here
// rather than through Playwright's webServer hook, which then reuses it.
const forwarded = process.argv.slice(2).map(arg => `'${arg.replaceAll("'", `'\''`)}'`).join(' ');
const script = [
  'python3 scripts/serve.py >/dev/null 2>&1 &',
  'for _ in $(seq 1 50); do',
  '  python3 -c "import socket; socket.create_connection((\'127.0.0.1\', 8474), 0.2)" 2>/dev/null && break',
  '  sleep 0.2',
  'done',
  `npx playwright test tests/e2e/visual-regression.spec.js ${forwarded}`,
].join('\n');

const run = docker([
  'run', '--rm', '--ipc=host',
  '-v', `${repoRoot}:/work`,
  '-w', '/work',
  '-e', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
  image,
  'bash', '-lc', script,
], { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });

process.exit(run.status ?? 1);
