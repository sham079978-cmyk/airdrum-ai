import { defineConfig } from 'vite';

// AirDrum AI — Vite configuration.
// Kept deliberately simple: a static single-page app, no backend.
export default defineConfig({
  root: '.',
  base: './',
  server: {
    port: 5173,      // default Vite port
    host: true,      // also reachable on your LAN (handy for testing on another device)
    open: false,
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: true,
  },
});
