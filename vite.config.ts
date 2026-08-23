import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  build: { target: 'es2022' },
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
