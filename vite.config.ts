import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build loads from Electron's app:// scheme and from serve.mjs alike.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
