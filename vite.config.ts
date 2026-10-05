/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// PR previews have no question database: `PLUNGE_QUESTIONS=local-only` builds an
// app that keeps questions on the device. Anything unexpected fails the build.
const questions = process.env.PLUNGE_QUESTIONS || 'remote';
if (questions !== 'remote' && questions !== 'local-only')
  throw new Error(`PLUNGE_QUESTIONS must be "remote" or "local-only", not "${questions}".`);

export default defineConfig({
  plugins: [preact(), {
    // Lets preview tooling confirm what was built, before and after deployment.
    name: 'plunge-questions-mode',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'plunge-questions', content: questions }, injectTo: 'head' }],
  }],
  server: {
    proxy: { '/api/questions': { target: `http://127.0.0.1:${process.env.PLUNGE_QUESTIONS_PORT ?? '8787'}` }, '/api': { target: `http://127.0.0.1:${process.env.PLUNGE_BRIDGE_PORT ?? '4245'}` } },
  },
  build: { target: 'es2022' },
  test: {
    // Several test files hold a core in long synchronous solver loops (hard's
    // PIMC matches, walt's wasm solves). Run in parallel on a small CI runner
    // they starve each other's event loops past vitest's 60s worker-RPC ack
    // timeout — every test passes, then the run fails on a spurious
    // "Timeout calling onTaskUpdate". One file at a time on CI is plenty.
    fileParallelism: !process.env.CI,
  },
  // Browser builds use ort's plain-wasm bundle: the default bundle ships the
  // 26 MB jsep (WebGPU) binary, which is over Cloudflare Workers' 25 MiB
  // asset limit — and onyx's 1.2 MB model doesn't need WebGPU. Vitest keeps
  // the unaliased package so Node resolves ort's native backend.
  resolve: process.env.VITEST
    ? undefined
    : { alias: { 'onnxruntime-web': 'onnxruntime-web/wasm' } },
  define: {
    // Stamped with the commit SHA in CI; 'dev' locally (disables update polling).
    __BUILD_ID__: JSON.stringify(process.env.GITHUB_SHA ?? 'dev'),
    __QUESTIONS_LOCAL_ONLY__: JSON.stringify(questions === 'local-only'),
  },
});
