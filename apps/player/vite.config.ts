import { defineConfig } from 'vite';

// Base relative : le build fonctionne sous n'importe quel chemin (GitHub Pages, /play/ de l'éditeur…).
export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 2000 },
  optimizeDeps: { exclude: ['@wllama/wllama'] },
});
