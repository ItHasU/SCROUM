/** Zone d'interaction : journal de la scène, sorties, ou dialogue (selon le skin du monde). */
import { NARRATOR } from '@scroum/schema';
import { characterView, dialogueView, sceneView, visibleExits } from '@scroum/engine';
import type { LogEntry } from '../log';
import { assetImage, smileys, type ViewContext } from './context';
import { button, h, replace } from './h';

/** Heure fictive d'une entrée (skin chat_retro). */
function fakeTime(id: number): string {
  const m = 21 * 60 + 7 + id;
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export class PanelView {
  readonly el: HTMLElement;
  private lastLogKey = '';

  constructor(private readonly ctx: ViewContext) {
    this.el = h('section.panel', { 'aria-live': 'polite' });
  }

  render(): void {
    const { ctrl } = this.ctx;
    const inDialogue = !!ctrl.state.dialogue || !!ctrl.lingering;
    this.el.dataset.mode = inDialogue ? 'dialogue' : 'scene';
    if (inDialogue) this.renderDialogue();
    else this.renderScene();
  }

  private entry(e: LogEntry, skin: string): HTMLElement {
    if (e.kind === 'info') return h('div.msg.info', { 'data-tone': e.tone, 'data-id': e.id }, h('span.txt', null, e.text));
    const narrator = e.speaker === NARRATOR;
    const text = skin === 'chat_retro' ? smileys(e.text) : e.text;
    return h(
      'div.msg',
      {
        class: [narrator ? 'narrator' : 'char', e.player ? 'me' : '', e.refuse ? 'refuse' : '', e.typed ? 'typed' : ''].filter(Boolean).join(' '),
        'data-id': e.id,
        'data-speaker': e.speaker,
        title: e.original ? `Réplique d'origine : ${e.original}` : null,
      },
      skin === 'chat_retro' ? h('span.time', null, `[${fakeTime(e.id)}]`) : null,
      narrator ? null : h('span.who', null, e.name ?? e.speaker),
      h('span.txt', null, text),
    );
  }

  private scrollToEnd(box: HTMLElement): void {
    requestAnimationFrame(() => (box.scrollTop = box.scrollHeight));
    box.scrollTop = box.scrollHeight;
  }

  private renderScene(): void {
    const { ctrl } = this.ctx;
    const skin = sceneView(ctrl.game, ctrl.state)?.skin ?? 'plain';
    const entries = ctrl.log.slice(-80);
    const log = h('div.log', { role: 'log' }, entries.map((e) => this.entry(e, skin)));
    if (!entries.length) log.append(h('div.msg.hint', null, 'Touchez un élément de la scène pour interagir.'));
    const exits = ctrl.state.ending ? [] : visibleExits(ctrl.game, ctrl.state);
    replace(
      this.el,
      log,
      exits.length
        ? h(
            'div.exits-bar',
            { 'aria-label': 'Sorties' },
            exits.map((ex) => button('exit-btn', ['➜ ', ex.label], () => ctrl.dispatch({ type: 'exit', exit: ex.id }), { 'data-exit': ex.id })),
          )
        : null,
    );
    this.scrollToEnd(log);
  }

  private renderDialogue(): void {
    const { ctrl, ui } = this.ctx;
    const dv = dialogueView(ctrl.game, ctrl.state);
    const lingering = ctrl.lingering;
    const dialogueId = dv?.dialogue ?? lingering?.dialogue ?? '';
    const d = ctrl.game.dialogues[dialogueId];
    const speaker = d ? characterView(ctrl.game, ctrl.state, d.speaker) : null;
    const skin = dv?.skin ?? lingering?.skin ?? 'plain';
    const session = ctrl.currentSession;
    const entries = ctrl.log.filter((e) => e.session === session && session !== null);
    const name = speaker?.name ?? d?.speaker ?? '…';
    const world = ctrl.game.worlds[sceneView(ctrl.game, ctrl.state)?.world ?? '']?.name ?? '';

    const head = h(
      'div.dlg-head',
      null,
      h('div.dlg-titlebar', null, h('span', null, `#${(world || 'canal').toLowerCase().replace(/[^a-z0-9]+/gi, '-')}`), h('span.dlg-titlebar-btns', { 'aria-hidden': 'true' }, '_ □ ×')),
      h(
        'div.dlg-card',
        null,
        assetImage(this.ctx, speaker?.avatar ?? speaker?.portrait ?? null, name, 'dlg-avatar'),
        h(
          'div.dlg-id',
          null,
          h('div.dlg-name', null, name),
          speaker?.description ? h('div.dlg-desc', null, speaker.description) : null,
          h('div.dlg-hp', { 'aria-hidden': 'true' }, h('span.dlg-hp-label', null, 'PV'), h('span.dlg-hp-bar', null, h('span.dlg-hp-fill'))),
        ),
      ),
    );
    const transcript = h('div.dlg-log', { role: 'log' }, entries.map((e) => this.entry(e, skin)));

    const controls = h('div.dlg-controls');
    const sel = ctrl.selected;
    const selName = sel ? (ctrl.game.items[sel]?.name ?? sel) : null;
    if (!dv) {
      controls.append(button('btn primary continue', 'Suite ▸', () => ctrl.closeLingering(), { 'data-action': 'close' }));
    } else {
      if (dv.mode === 'continue') controls.append(button('btn primary continue', 'Suite ▸', () => ctrl.dispatch({ type: 'continue' }), { 'data-action': 'continue' }));
      if (dv.mode === 'input') {
        const list = h(
          'div.choices',
          null,
          dv.choices.map((c, i) =>
            button('btn choice', [h('span.choice-n', null, `${i + 1}.`), ' ', c.label], () => ctrl.dispatch({ type: 'choose', choice: c.index }), { 'data-choice': c.index }),
          ),
        );
        if (dv.choices.length) controls.append(list);
        const showFree = dv.free_text && (this.ctx.settings.assistant !== 'off' || dv.choices.length === 0);
        if (showFree) {
          const input = h('input.free-input', {
            type: 'text',
            enterkeyhint: 'send',
            autocomplete: 'off',
            placeholder: dv.free_text!.placeholder ?? `Dire quelque chose à ${name}…`,
            'aria-label': 'Texte libre',
            value: ui.draft,
            disabled: ctrl.busy,
            maxlength: 200,
          });
          input.addEventListener('input', () => (ui.draft = input.value));
          const form = h(
            'form.free-text',
            {
              onsubmit: (ev: Event) => {
                ev.preventDefault();
                const text = input.value;
                if (!text.trim()) return;
                ui.draft = '';
                void ctrl.submitText(text);
              },
            },
            skin === 'chat_retro' ? h('span.prompt', { 'aria-hidden': 'true' }, '>') : null,
            input,
            h('button.btn.send', { type: 'submit', disabled: ctrl.busy, 'aria-label': 'Envoyer' }, ctrl.busy ? '…' : 'Dire'),
          );
          controls.append(form);
          if (skin === 'chat_retro') {
            controls.append(
              h(
                'div.dlg-smileys',
                null,
                ['☺', '😉', '😄', '☹', '♥'].map((s) =>
                  button('smiley', s, () => {
                    ui.draft = (input.value + ' ' + s).trimStart();
                    input.value = ui.draft;
                    input.focus();
                  }),
                ),
              ),
            );
          }
        }
      }
      if (dv.can_give || dv.can_show) {
        const offer = h('div.offer');
        if (sel) {
          if (dv.can_give) offer.append(button('btn give', `Donner ${selName}`, () => ctrl.offerSelected('give'), { 'data-action': 'give' }));
          if (dv.can_show) offer.append(button('btn show', `Montrer ${selName}`, () => ctrl.offerSelected('show'), { 'data-action': 'show' }));
          offer.append(button('btn ghost', '✕', () => ctrl.select(null), { 'aria-label': 'Désélectionner' }));
        } else if (Object.keys(ctrl.state.inventory).length) {
          const verbs = [dv.can_give ? 'donner' : '', dv.can_show ? 'montrer' : ''].filter(Boolean).join(' / ');
          offer.append(button('btn ghost offer-open', `🎒 Choisir un objet à ${verbs}…`, () => this.ctx.setDrawer(true), { 'data-action': 'offer' }));
        }
        if (offer.childElementCount) controls.append(offer);
      }
      if (dv.can_leave) controls.append(button('btn ghost leave', 'Quitter', () => ctrl.dispatch({ type: 'leave' }), { 'data-action': 'leave' }));
    }

    const key = `${dialogueId}|${session}`;
    const fresh = key !== this.lastLogKey;
    this.lastLogKey = key;
    replace(this.el, h('div.dialogue', { 'data-skin': skin, 'data-dialogue': dialogueId, class: fresh ? 'fresh' : null }, head, transcript, controls));
    this.scrollToEnd(transcript);
  }
}
