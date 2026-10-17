import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  root: 'apps/web',
  publicDir: resolve('public'),
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001', '/assets/optimized/': 'http://127.0.0.1:3001' },
  },
  build: { outDir: resolve('dist/web'), emptyOutDir: true, chunkSizeWarningLimit: 1800 },
  worker: { format: 'es' },
});
