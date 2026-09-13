/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.PLUNGE_BRIDGE_PORT ?? '4245'}` } },
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
  },
});
