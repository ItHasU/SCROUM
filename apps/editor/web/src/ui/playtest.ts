/** Vue Playtest : player en iframe + panneau de debug alimenté par postMessage. */
import { h, render } from '../dom';
import { parsePlayerMessage, playUrl, type DebugState, type IntentInfo } from '../model/protocol';
import { on, state } from '../store';
import type { View } from './view';

type EventLike = { type: string; [k: string]: unknown };

export function createPlaytestView(): View {
  let frame: HTMLIFrameElement | null = null;
  let last: { state: DebugState; events: EventLike[]; intent: IntentInfo | null } | null = null;
  let intentShown: IntentInfo | null = null;
  const log: string[] = [];
  let loadedScene: string | null | undefined;

  const frameBox = h('div', { class: 'frame-box' });
  const panel = h('div', { class: 'debug' });
  const el = h('div', { class: 'view playtest' }, frameBox, panel);

  const post = (msg: unknown): void => frame?.contentWindow?.postMessage(msg, location.origin);

  function loadFrame(scene: string | null): void {
    loadedScene = scene;
    last = null;
    frame = h('iframe', { class: 'play', src: playUrl(scene), title: 'Playtest', allow: 'autoplay' });
    render(
      frameBox,
      h('div', { class: 'toolbar' }, h('a', { href: playUrl(scene), target: '_blank', rel: 'noopener' }, 'Ouvrir dans un onglet'), h('button', { onclick: () => post({ scroum: 'restart', ...(state.playScene ? { scene: state.playScene } : {}) }) }, 'Recommencer'), h('button', { onclick: () => loadFrame(null) }, 'Depuis le début'), scene ? h('span', { class: 'tag' }, `depuis ${scene}`) : null),
      frame,
    );
    drawPanel();
  }

  function sendState(mutate: (s: DebugState) => void): void {
    if (!last) return;
    const next = structuredClone(last.state);
    mutate(next);
    post({ scroum: 'set_state', state: next });
  }

  function numberRow(label: string, value: number, onChange: (v: number) => void, onRemove?: () => void): HTMLElement {
    return h(
      'div',
      { class: 'kv' },
      h('span', null, label),
      h('input', { type: 'number', value, onchange: (e: Event) => onChange(Number((e.target as HTMLInputElement).value)) }),
      onRemove ? h('button', { class: 'x', title: 'Retirer', onclick: onRemove }, '×') : null,
    );
  }

  function drawPanel(): void {
    if (!last) {
      render(panel, h('h3', null, 'Debug'), h('p', { class: 'muted' }, 'En attente du player… (il doit envoyer un message « state » après chaque action ; voir « Protocole playtest » dans docs/ARCHITECTURE.md).'));
      return;
    }
    const s = last.state;
    const game = state.game;
    const itemIds = Object.keys(game?.items ?? {}).filter((i) => !(i in s.inventory));
    const flagInput = h('input', { type: 'text', placeholder: 'nouveau drapeau', list: 'flag-list' });
    const itemSel = h('select', null, h('option', { value: '' }, '+ objet…'), itemIds.map((i) => h('option', { value: i }, game?.items[i]?.name ?? i)));
    itemSel.addEventListener('change', () => {
      if (itemSel.value) sendState((st) => void (st.inventory[itemSel.value] = 1));
    });
    const it = intentShown;
    render(
      panel,
      h('h3', null, 'Debug'),
      h('div', { class: 'dbg-sec' }, h('b', null, 'Nœud courant'), h('div', null, `scène : ${s.scene || '?'}`), h('div', null, s.dialogue ? `dialogue : ${s.dialogue.id} › ${s.dialogue.node}` : 'pas de dialogue'), s.ending ? h('div', { class: 'warn-text' }, `fin : ${s.ending.id} (${s.ending.type})`) : null),
      h(
        'div',
        { class: 'dbg-sec' },
        h('b', null, 'Dernière intention'),
        it
          ? h('div', null, h('div', null, it.text ? `« ${it.text} » → ` : '', h('code', null, it.intent ?? 'aucune')), h('div', { class: 'meter', title: `confiance ${it.confidence.toFixed(2)}` }, h('i', { style: `width:${Math.round(Math.min(1, it.confidence) * 100)}%` }), it.threshold !== undefined ? h('em', { style: `left:${Math.round(it.threshold * 100)}%`, title: `seuil ${it.threshold}` }) : null), h('small', { class: 'muted' }, `confiance ${it.confidence.toFixed(2)}${it.threshold !== undefined ? ` / seuil ${it.threshold}` : ''}${it.accepted === undefined ? '' : it.accepted ? ' — retenue' : ' — rejetée'}`))
          : h('span', { class: 'muted' }, 'aucune saisie libre'),
      ),
      h(
        'div',
        { class: 'dbg-sec' },
        h('b', null, `Drapeaux (${s.flags.length})`),
        h('div', { class: 'chips' }, s.flags.map((f) => h('span', { class: 'chip' }, f, h('button', { class: 'x', onclick: () => sendState((st) => void (st.flags = st.flags.filter((x) => x !== f))) }, '×')))),
        h('form', { class: 'inline', onsubmit: (e: Event) => { e.preventDefault(); const v = flagInput.value.trim(); if (v) sendState((st) => void (st.flags = [...new Set([...st.flags, v])].sort())); } }, flagInput, h('button', null, '+')),
      ),
      h('div', { class: 'dbg-sec' }, h('b', null, 'Variables'), Object.keys(s.vars).length ? Object.entries(s.vars).map(([k, v]) => numberRow(k, v, (n) => sendState((st) => void (st.vars[k] = n)))) : h('span', { class: 'muted' }, 'aucune')),
      h('div', { class: 'dbg-sec' }, h('b', null, 'Compteurs'), Object.keys(s.counters).length ? Object.entries(s.counters).map(([k, v]) => numberRow(game?.counters[k]?.label ?? k, v, (n) => sendState((st) => void (st.counters[k] = n)))) : h('span', { class: 'muted' }, 'aucun')),
      h('div', { class: 'dbg-sec' }, h('b', null, 'Inventaire'), Object.entries(s.inventory).map(([k, v]) => numberRow(game?.items[k]?.name ?? k, v, (n) => sendState((st) => { if (n <= 0) delete st.inventory[k]; else st.inventory[k] = n; }), () => sendState((st) => void delete st.inventory[k]))), itemSel),
      h('details', { class: 'dbg-sec' }, h('summary', null, `Derniers événements (${last.events.length})`), h('pre', null, last.events.map((e) => JSON.stringify(e)).join('\n'))),
      h('details', { class: 'dbg-sec' }, h('summary', null, 'État brut'), h('pre', null, JSON.stringify(s, null, 1))),
    );
    void log;
  }

  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.origin !== location.origin || !frame || ev.source !== frame.contentWindow) return;
    const msg = parsePlayerMessage(ev.data);
    if (!msg) return;
    if (msg.scroum === 'state') {
      if (msg.intent) intentShown = msg.intent;
      last = { state: msg.state, events: msg.lastEvents, intent: msg.intent ?? null };
      drawPanel();
    }
  });
  on('play', () => loadFrame(state.playScene));

  return {
    el,
    update: () => {
      if (last) drawPanel();
    },
    onShow: () => {
      if (!frame || loadedScene === undefined) loadFrame(state.playScene);
    },
  };
}
