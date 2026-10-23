import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { host: '0.0.0.0', proxy: { '/api': 'http://localhost:3000', '/embed.js': 'http://localhost:3000', '/feed': 'http://localhost:3000' } },
});
