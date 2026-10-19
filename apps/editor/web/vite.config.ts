import { defineConfig } from 'vite';

// Build statique du front de l'éditeur (mode production, ex. application de bureau). En dev,
// le serveur l'utilise via Vite en middlewareMode (les options passées en ligne priment).
export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 2000 },
});
