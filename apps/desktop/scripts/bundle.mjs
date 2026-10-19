// Construit apps/desktop/dist : main (ESM) + preload (CJS) via esbuild, fronts via `vite build`, accueil et doc du format.
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '../..');
const dist = join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// `vite` (middlewares de dev, jamais chargés en mode production), `sharp` (optionnel, repli en copie brute) et `fsevents`
// (optionnel, macOS) restent externes : aucun module natif n'est embarqué.
await esbuild({
  entryPoints: [join(root, 'src/main.ts')],
  outfile: join(dist, 'main.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['electron', 'vite', 'sharp', 'fsevents'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
await esbuild({
  entryPoints: [join(root, 'src/preload.ts')],
  outfile: join(dist, 'preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'info',
});
await cp(join(root, 'src/home.html'), join(dist, 'home.html'));
await cp(join(repo, 'docs/FORMAT.md'), join(dist, 'FORMAT.md'));

for (const [dir, out] of [['apps/player', 'player'], ['apps/editor/web', 'web']]) {
  const r = join(repo, dir);
  await vite({ root: r, logLevel: 'warn', build: { outDir: join(dist, out), emptyOutDir: true } });
}
console.log('dist prêt :', dist);
