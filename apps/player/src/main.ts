/** Point d'entrée du player statique. */
import '@scroum/ui/style.css';
import './home.css';
import { PlayerApp, readParams } from './app';

const root = document.getElementById('app')!;
const app = new PlayerApp(root, readParams());
(window as unknown as { scroum?: PlayerApp }).scroum = app;
void app.boot();

// PWA : service worker en production seulement, hors iframe et hors source directe (éditeur).
if (import.meta.env.PROD && 'serviceWorker' in navigator && !app.embedded && !app.params.source) {
  // Une nouvelle version du lecteur prend la main (skipWaiting + claim) : on recharge pour ne pas rester sur l'ancien code.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e: unknown) => console.warn('[scroum] service worker non enregistré', e));
  });
}
