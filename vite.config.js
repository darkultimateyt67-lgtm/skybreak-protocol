import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the built game runs from wherever it is put:
  // a GitHub Pages project site lives under /<repo>/, and itch.io serves an
  // HTML5 upload from a sub-folder inside an iframe. An absolute '/' base
  // would 404 every script on both.
  base: './',
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500
  }
});
