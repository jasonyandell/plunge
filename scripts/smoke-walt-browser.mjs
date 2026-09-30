/** Optional desktop browser smoke. Supply an installed Playwright module URL;
 * no browser automation dependency is shipped with the app.
 * PLAYWRIGHT_MODULE=file:///path/to/playwright/index.mjs node scripts/smoke-walt-browser.mjs
 * WALT_SMOKE_URL defaults to the Vite dev server; previews discover built assets.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest from '../src/ai/phone/manifest.json' with { type: 'json' };

const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const url = process.env.WALT_SMOKE_URL ?? 'http://127.0.0.1:5187/';
const rows = [];
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.getByText('Advanced settings', { exact: true }).click();
    await page.getByRole('radio', { name: 'Walt L2', exact: true }).waitFor();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
        `${name} horizontal overflow at ${width}`);
    }
    const scripts = await page.locator('script[type=module][src]').evaluateAll(nodes => nodes.map(n => n.src));
    const builtScript = scripts.find(path => new URL(path).pathname.startsWith('/assets/'));
    let workerUrl;
    if (builtScript) {
      const source = await (await fetch(builtScript)).text();
      const workerPath = source.match(/\/assets\/worker-[\w-]+\.js/)?.[0];
      assert.ok(workerPath, 'built app must name its actual worker');
      workerUrl = new URL(workerPath, url).href;
      const workerSource = await (await fetch(workerUrl)).text();
      const wasmPath = workerSource.match(/\/assets\/walt-player-[\w-]+\.wasm/)?.[0];
      assert.ok(wasmPath, 'built worker must name its actual WASM');
      const bytes = await (await fetch(new URL(wasmPath, url))).arrayBuffer();
      assert.equal(createHash('sha256').update(Buffer.from(bytes)).digest('hex'), manifest.wasm_sha256);
    }
    const result = await page.evaluate(async ({ workerUrl }) => {
      // Dev exercises the production client. Built previews exercise the real
      // deployed worker and ABI without exposing a debug entry point in the app.
      const runPlayer = workerUrl ? (call, signal) => new Promise((resolve, reject) => {
        const worker = new Worker(workerUrl, { type: 'module' });
        const finish = (value, error) => {
          clearTimeout(timer); worker.terminate(); signal?.removeEventListener('abort', abort);
          error ? reject(error) : resolve(value);
        };
        const abort = () => finish(undefined, new DOMException('Stopped', 'AbortError'));
        const timer = setTimeout(() => finish(undefined, new Error('Worker timeout')), 24000);
        signal?.addEventListener('abort', abort, { once: true });
        worker.onmessage = ({ data }) => {
          if (data.result?.error || data.error) finish(undefined, new Error(data.result?.error ?? data.error));
          else if (data.result) finish(data.result);
        };
        worker.onerror = error => finish(undefined, new Error(error.message));
        worker.postMessage({ id: 0, call });
      }) : (await import('/src/ai/phone/client.ts')).runPlayer;
      const inputs = [
        { decl: 3, bid: 30, bidder: 1, seat: 1, seed: 57, hand: [0,1,2,3,4,5,6], plays: [] },
        { contract: 'nello', decl: 8, bid: 1, bidder: 0, seat: 3, seed: 1,
          hand: [4,7,12,14,16,25,27], plays: [0,3,1,23,3,12,1,11,3,25,0,13,3,27,0,9,1,2] },
      ];
      const values = [];
      for (const request of inputs) {
        const start = performance.now();
        const value = await runPlayer({ request, worlds: 160, profile: [24,160], partner: false,
          nello_counterexamples: request.contract === 'nello', budget_ms: 20000 });
        values.push({ request, value, wall_ms: performance.now() - start });
      }
      const controller = new AbortController();
      const pending = runPlayer({ request: inputs[0], worlds: 640, profile: [640,640,640],
        partner: false, budget_ms: 20000 }, controller.signal);
      controller.abort();
      let cancelled = false;
      try { await pending; } catch (error) { cancelled = error.name === 'AbortError'; }
      return { values, cancelled };
    }, { workerUrl });
    assert.deepEqual(errors, []);
    assert.equal(result.cancelled, true);
    for (const { value } of result.values) {
      assert.equal(value.player_version, 'walt-table-v3');
      assert.deepEqual(value.profile, { delta: 1, level: 2, samples: [24,160] });
      assert.equal(value.interruption, undefined);
      assert.ok(Number.isInteger(value.trick));
    }
    assert.equal(result.values[0].value.choice, 5);
    assert.equal(result.values[1].value.choice, 16);
    if (process.env.WALT_SMOKE_SCREENSHOT_PREFIX) {
      await page.screenshot({ path: `${process.env.WALT_SMOKE_SCREENSHOT_PREFIX}-${name}.png`, fullPage: true });
    }
    rows.push({ browser: name, version: browser.version(), mode: workerUrl ? 'built-worker' : 'dev-client', ...result });
  } finally { await browser.close(); }
}
const evidence = { url, source_commit: manifest.source_commit, wasm_sha256: manifest.wasm_sha256,
  scope: 'Desktop Chromium and WebKit; not a physical phone measurement.', rows };
if (process.env.WALT_SMOKE_OUTPUT) writeFileSync(process.env.WALT_SMOKE_OUTPUT, JSON.stringify(evidence, null, 2) + '\n');
console.log(rows.map(row => ({ browser: row.browser, mode: row.mode, cancelled: row.cancelled,
  runs: row.values.map(run => ({ contract: run.request.contract ?? 'straight', wall_ms: run.wall_ms, choice: run.value.choice })) })));
