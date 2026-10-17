import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist/player',
    chunkSizeWarningLimit: 1800,
    rollupOptions: { input: 'player.html' },
  },
});
