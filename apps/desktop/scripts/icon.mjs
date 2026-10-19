// Régénère build/icon.png (1024x1024) depuis l'SVG ci-dessous — nécessite `sharp` (non requis pour le build normal).
import sharp from 'sharp'; // exécuter depuis packages/build (où sharp est installé) : cp scripts/icon.mjs ../../packages/build/
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3350"/><stop offset="1" stop-color="#15171c"/></linearGradient></defs>
<rect width="1024" height="1024" rx="200" fill="url(#g)"/>
<circle cx="760" cy="270" r="95" fill="#f2c36b"/>
<path d="M0 760 Q250 660 512 740 T1024 720 V1024 H0Z" fill="#0d0f14"/>
<path d="M440 760 L480 300 H580 L620 760Z" fill="#e8e2d0"/>
<path d="M470 420 H590 L598 500 H462Z M458 560 H602 L610 640 H450Z" fill="#c8872e"/>
<rect x="450" y="230" width="140" height="80" rx="14" fill="#f2c36b"/>
<path d="M470 230 L520 170 L570 230Z" fill="#c8872e"/>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile(join(dirname(fileURLToPath(import.meta.url)), '../build/icon.png'));
