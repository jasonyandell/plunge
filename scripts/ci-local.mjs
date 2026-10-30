/** Run exactly what CI runs, locally. The steps are read from .github/workflows/ci.yml,
 * so this can't drift from CI. Keeps going past failures and prints a summary.
 *
 *   npm run ci:local             every step
 *   npm run ci:local -- browser  only steps whose command contains "browser"
 *
 * `npm ci` runs only when node_modules is missing; Playwright's browser install is skipped
 * because Chromium is already on this machine. */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const filter = process.argv[2];
const steps = readFileSync('.github/workflows/ci.yml', 'utf8').split('\n')
  .map(line => /^\s*- run: (.+)$/.exec(line)?.[1].trim()).filter(Boolean)
  .filter(step => !/^npx playwright install/.test(step))
  .filter(step => step !== 'npm ci' || !existsSync('node_modules'))
  // A filtered run still needs the build the browser checks serve.
  .filter(step => !filter || step.includes(filter) || /npm run build/.test(step));

const results = [];
for (const step of steps) {
  console.log(`\n▶ ${step}`);
  const start = Date.now();
  const { status } = spawnSync(step, { shell: true, stdio: 'inherit' });
  results.push({ step, ok: status === 0, seconds: Math.round((Date.now() - start) / 1000) });
}
console.log('\nci:local summary');
for (const { step, ok, seconds } of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(seconds).padStart(4)}s  ${step}`);
process.exit(results.every(r => r.ok) ? 0 : 1);
