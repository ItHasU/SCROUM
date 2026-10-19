/** Effets : notifications (toasts) et animation d'acquisition vers le tiroir. */
import type { EngineEvent } from '@scroum/engine';
import type { GameData } from '@scroum/schema';
import { h } from './h';

export class Toasts {
  readonly el: HTMLElement;

  constructor() {
    this.el = h('div.toasts', { 'aria-live': 'polite', role: 'status' });
  }

  show(text: string, tone = 'info', ms = 3200): void {
    const t = h('div.toast', { 'data-tone': tone }, text);
    this.el.append(t);
    while (this.el.childElementCount > 4) this.el.firstElementChild?.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 400);
    }, ms);
  }

  /** Notifications de compteur, quête, collection, révélation. */
  fromEvents(game: GameData, events: readonly EngineEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'counter_changed':
          if (e.hud) {
            const d = e.value - e.previous;
            this.show(`${e.label ?? e.counter} ${d >= 0 ? '+' : ''}${d}${e.title && e.title !== e.previous_title ? ` · ${e.title}` : ''}`, 'counter');
          }
          break;
        case 'quest_unlocked':
          this.show(`📜 Nouvelle quête : ${e.title ?? e.quest}`, 'quest');
          break;
        case 'quest_completed':
          this.show(`✔ Quête terminée : ${e.title ?? e.quest}`, 'quest');
          break;
        case 'collection_unlocked':
          this.show(`🖼 Galerie : ${e.title}`, 'collection');
          break;
        case 'character_revealed':
          this.show(`✨ ${e.persona_name ?? '?'} → ${e.name}`, 'reveal');
          break;
        case 'item_gained':
          this.show(`🎒 ${game.items[e.item]?.name ?? e.item}${e.qty > 1 ? ` ×${e.qty}` : ''}`, 'item', 2200);
          break;
        case 'error':
          this.show(`⚠ ${e.message}`, 'error', 4000);
          break;
        default:
          break;
      }
    }
  }
}

/** Fait voler une vignette depuis `from` vers `to` (Web Animations API si disponible). */
export function flyTo(layer: HTMLElement, label: string, from: DOMRect | null, to: HTMLElement | null): void {
  const fly = h('div.fly', null, label);
  layer.append(fly);
  const lr = layer.getBoundingClientRect();
  const tr = to?.getBoundingClientRect();
  const sx = from ? from.left + from.width / 2 - lr.left : lr.width / 2;
  const sy = from ? from.top + from.height / 2 - lr.top : lr.height * 0.3;
  const ex = tr ? tr.left + tr.width / 2 - lr.left : sx;
  const ey = tr ? tr.top + tr.height / 2 - lr.top : lr.height;
  fly.style.left = `${sx}px`;
  fly.style.top = `${sy}px`;
  const done = () => {
    fly.remove();
    to?.classList.add('pulse');
    setTimeout(() => to?.classList.remove('pulse'), 600);
  };
  if (typeof fly.animate !== 'function') {
    setTimeout(done, 50);
    return;
  }
  const a = fly.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 },
      { transform: 'translate(-50%, -120%) scale(1.15)', opacity: 1, offset: 0.25 },
      { transform: `translate(calc(-50% + ${ex - sx}px), calc(-50% + ${ey - sy}px)) scale(0.4)`, opacity: 0.2 },
    ],
    { duration: 900, easing: 'cubic-bezier(.5,0,.3,1)' },
  );
  a.onfinish = done;
  a.oncancel = done;
}
