import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  root: 'apps/web',
  base: './',
  publicDir: false,
  build: {
    outDir: resolve('dist/player'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1800,
    rollupOptions: { input: resolve('apps/web/player.html') },
  },
});
