import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

const api = process.env.API_URL || 'http://localhost:3000';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: process.env.OUT_DIR || '../dist',
    emptyOutDir: true,
    rollupOptions: {
      // ONLY=glasses or ONLY=index builds one page (handy while the other is being worked on)
      input: Object.fromEntries(
        Object.entries({
          index: resolve(import.meta.dirname, 'web/index.html'),
          glasses: resolve(import.meta.dirname, 'web/glasses.html'),
        }).filter(([k]) => !process.env.ONLY || process.env.ONLY === k),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/ws': { target: api.replace('http', 'ws'), ws: true },
    },
  },
});
