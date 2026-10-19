/** Fenêtres : menu, sauvegardes, quêtes, galerie, réglages, fiche d'objet. */
import { questLog, unlockedCollections, type CollectionView } from '@scroum/engine';
import { formatBytes } from '../backends/util';
import type { AssistantMode } from '../storage';
import { makeSave, parseSave, type SlotId } from '../storage';
import { assetImage, type ViewContext } from './context';
import { append, button, h, replace } from './h';

export class ModalView {
  readonly el: HTMLElement;
  private loadProgress: string | null = null;

  constructor(private readonly ctx: ViewContext) {
    this.el = h('div.modal-backdrop', { hidden: true });
    this.el.addEventListener('click', (ev) => {
      if (ev.target === this.el) this.ctx.openModal(null);
    });
  }

  render(): void {
    const kind = this.ctx.ui.modal;
    if (!kind) {
      this.el.hidden = true;
      replace(this.el);
      return;
    }
    this.el.hidden = false;
    const body = h('div.modal-body');
    let title = '';
    switch (kind) {
      case 'menu':
        title = 'Menu';
        this.menu(body);
        break;
      case 'saves':
        title = 'Sauvegardes';
        this.saves(body);
        break;
      case 'quests':
        title = 'Journal des quêtes';
        this.quests(body);
        break;
      case 'gallery':
        title = 'Galerie';
        this.gallery(body);
        break;
      case 'settings':
        title = 'Réglages';
        this.settingsView(body);
        break;
      case 'item':
        title = 'Objet';
        this.item(body);
        break;
      case 'confirm_new':
        title = 'Nouvelle partie';
        body.append(
          h('p', null, 'Recommencer depuis le début ? La partie en cours reste dans la sauvegarde automatique jusqu’à la prochaine action.'),
          h(
            'div.row',
            null,
            button('btn primary', 'Recommencer', () => {
              this.ctx.openModal(null);
              this.ctx.ctrl.newGame();
            }, { 'data-action': 'confirm-new' }),
            button('btn ghost', 'Annuler', () => this.ctx.openModal('menu')),
          ),
        );
        break;
    }
    replace(
      this.el,
      h(
        'div.modal',
        { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, 'data-modal': kind },
        h('div.modal-head', null, h('h2', null, title), button('btn ghost close', '✕', () => this.ctx.openModal(null), { 'aria-label': 'Fermer' })),
        body,
        this.ctx.ui.notice ? h('p.notice', null, this.ctx.ui.notice) : null,
      ),
    );
  }

  private menu(body: HTMLElement): void {
    const go = (k: Parameters<ViewContext['openModal']>[0]) => () => this.ctx.openModal(k);
    body.append(
      h(
        'div.menu-list',
        null,
        button('btn primary', 'Reprendre', go(null), { 'data-action': 'resume' }),
        button('btn', '💾 Sauvegarder / charger', go('saves'), { 'data-action': 'saves' }),
        button('btn', '📜 Journal des quêtes', go('quests')),
        button('btn', '🖼 Galerie', go('gallery')),
        button('btn', '⚙ Réglages', go('settings'), { 'data-action': 'settings' }),
        button('btn', '↺ Nouvelle partie', go('confirm_new'), { 'data-action': 'new' }),
        this.ctx.onHome ? button('btn ghost', '⌂ Accueil', () => (this.ctx.openModal(null), this.ctx.onHome?.())) : null,
      ),
      h('p.game-info', null, `${this.ctx.ctrl.game.meta.title} — v${this.ctx.ctrl.game.meta.version}`),
    );
  }

  private saves(body: HTMLElement): void {
    const { ctrl, saves } = this.ctx;
    const label = (slot: SlotId) => (slot === 'auto' ? 'Sauvegarde auto' : `Emplacement ${slot}`);
    const fmt = (iso: string) => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    };
    const list = h('ul.slots');
    for (const { slot, save } of saves.list()) {
      list.append(
        h(
          'li.slot',
          { 'data-slot': String(slot) },
          h('div.slot-info', null, h('strong', null, label(slot)), h('span', null, save ? `${save.label} · ${fmt(save.savedAt)}` : 'vide')),
          h(
            'div.slot-actions',
            null,
            slot !== 'auto' && !ctrl.state.ending
              ? button('btn small', 'Sauver', () => {
                  saves.write(slot, makeSave(ctrl.game, ctrl.state, ctrl.log));
                  this.ctx.ui.notice = `Partie sauvegardée (${label(slot)}).`;
                  this.render();
                }, { 'data-save': String(slot) })
              : null,
            save
              ? button('btn small primary', 'Charger', () => {
                  ctrl.loadState(save.state, save.log);
                  this.ctx.openModal(null);
                  this.ctx.toast('Partie chargée.');
                }, { 'data-load': String(slot) })
              : null,
          ),
        ),
      );
    }
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        const save = parseSave(await f.text());
        ctrl.loadState(save.state, save.log);
        this.ctx.openModal(null);
        this.ctx.toast('Sauvegarde importée.');
      } catch (e) {
        this.ctx.ui.notice = `Import impossible : ${(e as Error).message}`;
        this.render();
      }
    });
    body.append(
      list,
      h(
        'div.row',
        null,
        button('btn', '⬇ Exporter (JSON)', () => {
          const save = makeSave(ctrl.game, ctrl.state, ctrl.log);
          const blob = new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: `${ctrl.game.meta.title.replace(/[^\p{L}\p{N}]+/gu, '_')}-sauvegarde.json` });
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }, { 'data-action': 'export' }),
        button('btn', '⬆ Importer', () => file.click(), { 'data-action': 'import' }),
        file,
      ),
    );
  }

  private quests(body: HTMLElement): void {
    const q = questLog(this.ctx.ctrl.game, this.ctx.ctrl.state);
    if (!q.length) {
      body.append(h('p.empty', null, 'Aucune quête pour le moment.'));
      return;
    }
    body.append(
      h(
        'ul.quests',
        null,
        q.map((x) => h('li.quest', { 'data-quest': x.id, 'data-state': x.state }, h('span.quest-mark', null, x.state === 'completed' ? '✔' : '◆'), h('div', null, h('strong', null, x.title), x.description ? h('p', null, x.description) : null))),
      ),
    );
  }

  private collection(c: CollectionView): HTMLElement {
    const ctx = this.ctx;
    const ch = c.character;
    const pics: HTMLElement[] = [];
    if (ch) {
      if (ch.persona) pics.push(h('figure', null, assetImage(ctx, ch.persona.avatar, ch.persona.name, 'gal-img'), h('figcaption', null, ch.persona.name)));
      pics.push(h('figure', null, assetImage(ctx, ch.identity.portrait ?? ch.identity.avatar, ch.identity.name, 'gal-img'), h('figcaption', null, ch.identity.name)));
    }
    for (const img of c.images) pics.push(h('figure', null, assetImage(ctx, img, c.title, 'gal-img')));
    return h('li.gal-entry', { 'data-collection': c.id }, h('strong', null, c.title), pics.length ? h('div.gal-pics', { class: ch ? 'pair' : null }, pics) : null, c.text ? h('p', null, c.text) : null);
  }

  private gallery(body: HTMLElement): void {
    const { ctrl } = this.ctx;
    const unlocked = unlockedCollections(ctrl.game, ctrl.state);
    const total = ctrl.game.collections.length;
    body.append(h('p.gal-count', null, `${unlocked.length} / ${total} débloquée${total > 1 ? 's' : ''}`));
    if (!total) return;
    body.append(
      h(
        'ul.gallery',
        null,
        ctrl.game.collections.map((c) => {
          const u = unlocked.find((x) => x.id === c.id);
          return u ? this.collection(u) : h('li.gal-entry.locked', { 'data-collection': c.id }, h('strong', null, '???'), h('p', null, 'À découvrir…'));
        }),
      ),
    );
  }

  private item(body: HTMLElement): void {
    const { ctrl, ui } = this.ctx;
    const id = ui.itemDetail;
    const it = id ? ctrl.game.items[id] : undefined;
    if (!id || !it) {
      body.append(h('p', null, 'Objet inconnu.'));
      return;
    }
    const lines = ctrl.lastEvents.flatMap((e) => (e.type === 'say' ? [e] : []));
    const owned = (ctrl.state.inventory[id] ?? 0) > 0;
    append(body, [
      h(
        'div.item-detail',
        { 'data-item': id },
        assetImage(this.ctx, it.icon, it.name, 'item-big'),
        h('div', null, h('h3', null, it.name, (ctrl.state.inventory[id] ?? 0) > 1 ? ` ×${ctrl.state.inventory[id]}` : ''), it.description ? h('p', null, it.description) : null),
      ),
      lines.length ? h('div.item-lines', null, lines.map((l) => h('p.msg', null, l.name ? h('span.who', null, l.name) : null, h('span.txt', null, l.text)))) : null,
      owned && !ctrl.state.ending
        ? h(
            'div.row',
            null,
            button('btn primary', ctrl.selected === id ? '✓ En main' : 'Prendre en main', () => {
              ctrl.select(ctrl.selected === id ? null : id);
              this.ctx.openModal(null);
            }, { 'data-action': 'hold' }),
            button('btn ghost', 'Fermer', () => this.ctx.openModal(null)),
          )
        : null,
    ]);
  }

  private settingsView(body: HTMLElement): void {
    const { settings, assistant } = this.ctx;
    const check = (label: string, value: boolean, onChange: (v: boolean) => void, key: string) => {
      const input = h('input', { type: 'checkbox', 'data-setting': key });
      input.checked = value;
      input.addEventListener('change', () => onChange(input.checked));
      return h('label.check', null, input, ' ', label);
    };
    const modes: [AssistantMode, string, string][] = [
      ['off', 'Désactivé', 'Choix seulement (le champ libre reste proposé quand il n’y a aucun choix).'],
      ['keyword', 'Mots-clés', 'Reconnaissance par mots-clés, sans téléchargement (défaut).'],
      ['remote', 'Distant', 'Endpoint compatible OpenAI (JSON mode), repli sur les mots-clés.'],
      ['local', 'Local', `Petit LLM dans le navigateur (wllama), ≈ ${formatBytes(assistant.local.sizeBytes)} à télécharger une fois.`],
    ];
    const radios = h(
      'fieldset.radios',
      null,
      h('legend', null, 'Assistant IA (texte libre)'),
      modes.map(([m, label, help]) => {
        const r = h('input', { type: 'radio', name: 'assistant', value: m, 'data-setting': `assistant-${m}` });
        r.checked = settings.assistant === m;
        r.addEventListener('change', () => {
          if (!r.checked) return;
          if (m === 'local' && !settings.localConsent) {
            this.ctx.ui.notice = null;
            this.consent(body);
            return;
          }
          this.ctx.setSettings({ assistant: m });
          if (m === 'local') this.startLocal();
        });
        return h('label.radio', null, r, h('span', null, h('strong', null, label), h('small', null, help)));
      }),
    );
    const remote = settings.assistant === 'remote'
      ? h(
          'div.remote-fields',
          null,
          this.text('Endpoint', settings.remote.endpoint, (v) => this.ctx.setSettings({ remote: { ...this.ctx.settings.remote, endpoint: v } })),
          this.text('Modèle', settings.remote.model, (v) => this.ctx.setSettings({ remote: { ...this.ctx.settings.remote, model: v } })),
          this.text('Clé API (stockée localement)', settings.remote.apiKey, (v) => this.ctx.setSettings({ remote: { ...this.ctx.settings.remote, apiKey: v } }), 'password'),
        )
      : null;
    const local = settings.assistant === 'local'
      ? h('p.local-status', null, `Modèle local : ${({ idle: 'non chargé', loading: 'chargement…', ready: 'prêt', error: `erreur (${assistant.local.error ?? '?'}) — repli sur les mots-clés` } as const)[assistant.local.status]}${this.loadProgress ? ` ${this.loadProgress}` : ''}`,
          assistant.local.status === 'idle' || assistant.local.status === 'error' ? button('btn small', 'Charger', () => this.startLocal()) : null)
      : null;
    const sizes: [number, string][] = [
      [0.9, 'A−'],
      [1, 'A'],
      [1.15, 'A+'],
      [1.3, 'A++'],
    ];
    append(body, [
      check('Surligner les zones interactives', settings.highlightHotspots, (v) => this.ctx.setSettings({ highlightHotspots: v }), 'highlight'),
      h('div.row.text-size', null, h('span', null, 'Taille du texte'), sizes.map(([v, l]) => button(`btn small${settings.textScale === v ? ' primary' : ''}`, l, () => this.ctx.setSettings({ textScale: v })))),
      radios,
      remote,
      local,
      settings.assistant === 'remote' || settings.assistant === 'local'
        ? check('Reformuler les répliques dans la voix des personnages (expérimental)', settings.rephrase, (v) => this.ctx.setSettings({ rephrase: v }), 'rephrase')
        : null,
    ]);
  }

  private text(label: string, value: string, onChange: (v: string) => void, type = 'text'): HTMLElement {
    const input = h('input', { type, value, autocomplete: 'off' });
    input.addEventListener('change', () => onChange(input.value.trim()));
    return h('label.field', null, h('span', null, label), input);
  }

  /** Demande de consentement au téléchargement du modèle local (taille affichée). */
  private consent(body: HTMLElement): void {
    const size = formatBytes(this.ctx.assistant.local.sizeBytes);
    body.querySelector('.consent')?.remove();
    body.append(
      h(
        'div.consent',
        { role: 'alertdialog' },
        h('p', null, `Le mode local télécharge un modèle de langage d’environ ${size} (une seule fois, puis mis en cache dans le navigateur). Le jeu reste jouable sans lui. Continuer ?`),
        h(
          'div.row',
          null,
          button('btn primary', `Télécharger (${size})`, () => {
            this.ctx.setSettings({ assistant: 'local', localConsent: true });
            this.startLocal();
          }, { 'data-action': 'consent' }),
          button('btn ghost', 'Annuler', () => this.render()),
        ),
      ),
    );
  }

  private startLocal(): void {
    const local = this.ctx.assistant.local;
    if (local.status === 'loading' || local.status === 'ready') return;
    local
      .load((loaded, total) => {
        this.loadProgress = total ? `${Math.round((loaded / total) * 100)} %` : formatBytes(loaded);
        if (this.ctx.ui.modal === 'settings') {
          const p = this.el.querySelector('.local-status');
          if (p) p.firstChild!.textContent = `Modèle local : chargement… ${this.loadProgress}`;
        }
      })
      .then(() => {
        this.loadProgress = null;
        this.ctx.toast('Modèle local prêt.');
        this.render();
      })
      .catch((e: unknown) => {
        this.loadProgress = null;
        this.ctx.toast(`Modèle local indisponible : ${(e as Error).message}. Repli sur les mots-clés.`, 'error');
        this.render();
      });
    this.render();
  }
}
