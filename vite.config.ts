import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  build: { target: 'es2022' },
  define: {
    // Stamped with the commit SHA in CI; 'dev' locally (disables update polling).
    __BUILD_ID__: JSON.stringify(process.env.GITHUB_SHA ?? 'dev'),
  },
});
