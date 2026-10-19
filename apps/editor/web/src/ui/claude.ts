/** Panneau Claude : demande contextualisée, flux en direct, fichiers modifiés, diff et annulation. */
import { api } from '../api';
import { h, render } from '../dom';
import { claudeItems, type ClaudeItem } from '../model/claude-stream';
import { fileOf, KIND_LABEL, titleOf } from '../model/refs';
import { state } from '../store';
import { toast } from './common';
import type { View } from './view';

interface DoneMsg {
  code: number;
  error?: string;
  stderr?: string;
  files: string[] | null;
  git: boolean;
}

export function createClaudeView(): View {
  let running = false;
  let abort: AbortController | null = null;
  let attach = true;

  const prompt = h('textarea', { class: 'prompt', rows: 4, placeholder: 'Que faut-il écrire ou modifier ? (Ctrl+Entrée pour envoyer)' });
  const ctx = h('div', { class: 'ctx' });
  const stream = h('div', { class: 'stream' });
  const result = h('div', { class: 'changes' });
  const sendBtn = h('button', { class: 'primary', onclick: () => void send() }, 'Envoyer');
  const stopBtn = h('button', { hidden: true, onclick: () => abort?.abort() }, 'Arrêter');
  prompt.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void send();
  });
  const missing = h('div', { class: 'ctx', hidden: true });
  const el = h('div', { class: 'view claude' }, h('h2', null, 'Claude'), missing, ctx, prompt, h('div', { class: 'row' }, sendBtn, stopBtn), stream, result);

  function drawCtx(): void {
    const c = state.project?.claude;
    missing.hidden = !c || c.available;
    if (c && !c.available) render(missing, h('strong', null, `Claude Code (« ${c.command} ») est introuvable sur cette machine. `), 'Installez la CLI `claude` (https://claude.com/claude-code) puis relancez l’éditeur, ou indiquez son chemin dans scroum.local.yaml (claude.command).');
    const sel = state.selection;
    const game = state.game;
    if (!sel && !state.file) {
      render(ctx, h('span', { class: 'muted' }, 'Aucun élément sélectionné : la demande portera sur tout le jeu.'));
      return;
    }
    const label = sel && game ? `${KIND_LABEL[sel.kind]} « ${titleOf(game, sel)} »` : `fichier ${state.file}`;
    render(ctx, h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: attach, onchange: (e: Event) => void (attach = (e.target as HTMLInputElement).checked) }), `Joindre l’élément sélectionné : ${label}`));
  }

  function addItem(it: ClaudeItem): void {
    let node: HTMLElement;
    switch (it.kind) {
      case 'text':
        node = h('div', { class: 'msg text' }, it.text);
        break;
      case 'tool':
        node = h('div', { class: 'msg tool' }, h('b', null, it.name), ' ', h('code', null, it.summary));
        break;
      case 'tool_result':
        node = h('details', { class: `msg result ${it.error ? 'bad' : ''}` }, h('summary', null, it.error ? 'résultat (erreur)' : 'résultat'), h('pre', null, it.text));
        break;
      case 'system':
        node = h('div', { class: 'msg sys' }, it.text);
        break;
      case 'result':
        node = h('div', { class: `msg final ${it.error ? 'bad' : ''}` }, it.error ? 'Terminé avec erreur. ' : 'Terminé. ', it.cost !== undefined ? h('small', null, `${it.cost.toFixed(3)} $`) : null);
        break;
    }
    const atEnd = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 40;
    stream.appendChild(node);
    if (atEnd) stream.scrollTop = stream.scrollHeight;
  }

  async function showDiff(file: string, into: HTMLElement): Promise<void> {
    const d = await api.diff(file);
    render(
      into,
      d.split('\n').map((l) => h('div', { class: l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : '' }, l || ' ')),
    );
  }

  function drawChanges(done: DoneMsg): void {
    const files = done.files;
    if (done.error) render(result, h('div', { class: 'err-text' }, done.error));
    else render(result);
    if (done.stderr) result.appendChild(h('details', null, h('summary', null, 'stderr'), h('pre', null, done.stderr)));
    if (files === null) {
      result.appendChild(h('p', { class: 'muted' }, 'Dépôt non suivi par git : liste des fichiers modifiés, diff et annulation indisponibles.'));
      return;
    }
    if (files.length === 0) {
      result.appendChild(h('p', { class: 'muted' }, 'Aucun fichier modifié.'));
      return;
    }
    const rows = files.map((f) => {
      const diffBox = h('div', { class: 'diff', hidden: true });
      return h(
        'li',
        null,
        h('code', null, f),
        h('button', { onclick: () => { diffBox.hidden = !diffBox.hidden; if (!diffBox.hidden && !diffBox.firstChild) void showDiff(f, diffBox); } }, 'Diff'),
        h('button', { onclick: () => void revert([f]) }, 'Annuler'),
        diffBox,
      );
    });
    result.appendChild(h('div', null, h('h4', null, `Fichiers modifiés (${files.length})`), h('ul', { class: 'plain files-changed' }, rows), h('button', { class: 'danger', onclick: () => void revert(files) }, 'Tout annuler')));
  }

  async function revert(files: string[]): Promise<void> {
    if (!confirm(`Annuler les modifications de Claude sur ${files.length} fichier(s) ?\n${files.join('\n')}`)) return;
    const r = await api.revert(files);
    toast(r.ok ? 'Modifications annulées' : `Échec : ${r.error ?? 'inconnu'}`, r.ok ? 'ok' : 'err');
  }

  async function send(): Promise<void> {
    const text = prompt.value.trim();
    if (!text || running) return;
    running = true;
    abort = new AbortController();
    sendBtn.disabled = true;
    stopBtn.hidden = false;
    render(result);
    const game = state.game;
    const sel = state.selection;
    const selected = attach ? (sel ? { kind: sel.kind, id: sel.id, ...(game && fileOf(game, sel) ? { file: `content/${fileOf(game, sel)}` } : {}) } : state.file ? { file: `content/${state.file}` } : undefined) : undefined;
    stream.appendChild(h('div', { class: 'msg user' }, text));
    let done: DoneMsg | null = null;
    try {
      const res = await fetch('/api/claude', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: text, ...(selected ? { selected } : {}) }), signal: abort.signal });
      if (!res.ok || !res.body) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        addItem({ kind: 'result', text: '', error: true });
        toast(b.error ?? `Erreur ${res.status}`, 'err');
      } else {
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          buf += value;
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const line = chunk.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            let msg: { type: string; event?: unknown; text?: string } & Partial<DoneMsg>;
            try {
              msg = JSON.parse(line.slice(5)) as typeof msg;
            } catch {
              continue;
            }
            if (msg.type === 'claude') {
              if (msg.text) addItem({ kind: 'text', text: msg.text });
              for (const it of claudeItems(msg.event)) addItem(it);
            } else if (msg.type === 'done') done = { code: msg.code ?? -1, files: msg.files ?? null, git: !!msg.git, ...(msg.error ? { error: msg.error } : {}), ...(msg.stderr ? { stderr: msg.stderr } : {}) };
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'err');
      else addItem({ kind: 'system', text: 'Interrompu.' });
    } finally {
      running = false;
      sendBtn.disabled = false;
      stopBtn.hidden = true;
      prompt.value = '';
      if (done) drawChanges(done);
    }
  }

  return { el, update: drawCtx, onShow: drawCtx };
}
