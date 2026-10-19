/** Atelier d'images : génération de candidats (ComfyUI), sélection, variantes, comparaison, validation humaine. */
import { imagesApi, type AssetRow, type CandidateRow, type GenEvent } from '../api';
import { h, render } from '../dom';
import { state } from '../store';
import { badge, toast } from './common';
import type { View } from './view';
import type { Status } from '@scroum/schema';

const WORKFLOWS = ['bg', 'char_sheet', 'item_icon', 'char_edit', 'transform', 'remove_bg'];

export function createImagesView(): View {
  const el = h('div', { class: 'view images' });
  const listEl = h('div', { class: 'img-list' });
  const detail = h('div', { class: 'img-detail' });
  el.append(h('div', null, h('h2', null, 'Images'), h('div', { class: 'muted comfy', id: 'comfy-status' }), listEl), detail);

  let assets: AssetRow[] = [];
  let current: string | null = null;
  let cands: CandidateRow[] = [];
  let compareWith = '';
  let busy = false;
  /** Invalide le cache navigateur d'une image retenue après sélection. */
  const bust = new Map<string, number>();
  const imgUrl = (id: string): string => `/api/images/${encodeURIComponent(id)}?v=${bust.get(id) ?? 0}`;

  // Formulaire persistant (survit aux rafraîchissements).
  const prompt = h('textarea', { id: 'img-prompt', placeholder: 'Prompt (sans préfixe de style : il est ajouté depuis bible/style.md)' });
  const workflow = h('input', { id: 'img-workflow', list: 'img-workflows', placeholder: 'auto (selon le type)' });
  const refs = h('input', { id: 'img-refs', placeholder: 'ids d’assets séparés par des virgules' });
  const seed = h('input', { id: 'img-seed', type: 'number', placeholder: 'aléatoire' });
  const count = h('input', { id: 'img-n', type: 'number', value: '4', min: '1', max: '16' });
  const genBtn = h('button', { class: 'primary', id: 'img-generate', onclick: () => void generate() }, 'Générer');
  const bar = h('div');
  const progress = h('div', { class: 'img-progress' }, bar);
  const status = h('div', { class: 'muted', id: 'img-status' });
  const grid = h('div', { class: 'cand-grid', id: 'cand-grid' });
  const head = h('div', { class: 'row' });
  const currentBox = h('div', { class: 'img-current' });
  const compareBox = h('div');
  const form = h(
    'section',
    { class: 'card' },
    h('h3', null, 'Génération'),
    h(
      'div',
      { class: 'img-form' },
      h('label', null, 'Prompt'), prompt,
      h('label', null, 'Workflow'), h('div', null, workflow, h('datalist', { id: 'img-workflows' }, WORKFLOWS.map((w) => h('option', { value: w })))),
      h('label', null, 'Références'), refs,
      h('label', null, 'Graine'), seed,
      h('label', null, 'Candidats'), count,
    ),
    h('div', { class: 'row' }, genBtn, status),
    progress,
  );
  detail.append(head, h('div', { class: 'row', style: 'align-items:flex-start' }, currentBox), form, h('section', { class: 'card' }, h('h3', null, 'Candidats'), grid), compareBox);

  async function refreshAssets(): Promise<void> {
    assets = await imagesApi.assets();
    if (current && !assets.some((a) => a.id === current)) current = null;
    renderList();
    if (current) await refreshCandidates();
    else renderDetail();
  }

  async function refreshCandidates(): Promise<void> {
    cands = current ? await imagesApi.candidates(current) : [];
    renderDetail();
  }

  function renderList(): void {
    render(
      listEl,
      assets.length === 0 ? h('p', { class: 'muted' }, 'Aucun asset dans assets/assets.yaml.') : null,
      assets.map((a) =>
        h(
          'button',
          { class: `img-row${a.id === current ? ' active' : ''}`, dataset: { asset: a.id }, onclick: () => void open(a.id) },
          a.hasImage ? h('img', { class: 'thumb', src: imgUrl(a.id), loading: 'lazy', alt: '' }) : h('div', { class: 'thumb' }),
          h('div', { class: 'meta' }, h('span', null, a.id), h('small', { class: 'muted' }, a.kind, a.candidates ? ` · ${a.candidates} cand.` : ''), badge(a.status as Status)),
        ),
      ),
    );
  }

  async function open(id: string): Promise<void> {
    current = id;
    const a = assets.find((x) => x.id === id)!;
    prompt.value = a.prompt ?? '';
    workflow.value = a.workflow ?? '';
    refs.value = a.references.join(', ');
    seed.value = a.seed === null ? '' : String(a.seed);
    compareWith = linkedAsset(id) ?? '';
    status.textContent = '';
    renderList();
    await refreshCandidates();
  }

  /** Asset « lié » : `persona.avatar` ↔ `identity.portrait` d'un même personnage. */
  function linkedAsset(id: string): string | null {
    for (const c of Object.values(state.game?.characters ?? {})) {
      const a = c.persona?.avatar;
      const p = c.identity.portrait;
      if (a === id && p) return p;
      if (p === id && a) return a;
    }
    return null;
  }

  function renderDetail(): void {
    const a = assets.find((x) => x.id === current);
    detail.hidden = !a;
    if (!a) return;
    render(
      head,
      h('h3', null, a.id),
      badge(a.status as Status),
      h('small', { class: 'muted' }, `${a.kind}${a.world ? ` · monde ${a.world}` : ''}`),
      h('span', { class: 'spacer' }),
      h('button', {
        id: 'img-validate',
        class: 'primary',
        disabled: !a.hasImage || a.status === 'validated',
        title: "Action humaine : passe l'asset à « validé »",
        onclick: () => void validate(a.id),
      }, a.status === 'validated' ? 'Validé' : 'Valider'),
    );
    render(currentBox, a.hasImage ? h('img', { src: imgUrl(a.id), alt: a.id }) : h('p', { class: 'muted' }, 'Pas encore d’image retenue (placeholder dans le jeu).'));
    render(grid, cands.length === 0 ? h('p', { class: 'muted' }, 'Aucun candidat.') : null, [...cands].reverse().map(candidateCard));
    renderCompare();
  }

  function candidateCard(c: CandidateRow): HTMLElement {
    return h(
      'div',
      { class: 'cand', dataset: { n: c.n } },
      h('img', { src: `/api/candidates/${encodeURIComponent(current!)}/${c.file}`, loading: 'lazy', alt: `candidat ${c.n}` }),
      h('div', { class: 'row' }, h('small', null, `#${c.n} · graine ${c.seed}`), c.variantOf ? h('small', { class: 'muted' }, ` (variante de #${c.variantOf})`) : null),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'select', disabled: busy, onclick: () => void selectCandidate(c.n) }, 'Retenir'),
        h('button', { class: 'variant', disabled: busy, title: 'Édite ce candidat selon le prompt ci-dessus (workflow d’édition)', onclick: () => void generate(c.n) }, 'Variante'),
      ),
    );
  }

  function renderCompare(): void {
    const options = assets.filter((x) => x.id !== current);
    const other = assets.find((x) => x.id === compareWith);
    render(
      compareBox,
      h(
        'section',
        { class: 'card' },
        h('h3', null, 'Comparaison côte à côte'),
        h(
          'div',
          { class: 'row' },
          h('span', null, 'Avec :'),
          h(
            'select',
            { id: 'img-compare', onchange: (e: Event) => { compareWith = (e.target as HTMLSelectElement).value; renderCompare(); } },
            h('option', { value: '' }, '—'),
            options.map((o) => h('option', { value: o.id, selected: o.id === compareWith }, o.id)),
          ),
          linkedAsset(current ?? '') ? h('small', { class: 'muted' }, 'lié via le personnage') : null,
        ),
        other
          ? h('div', { class: 'cmp' }, compareCell(assets.find((x) => x.id === current)!), compareCell(other))
          : null,
      ),
    );
  }

  const compareCell = (a: AssetRow): HTMLElement =>
    h('div', null, h('div', { class: 'row' }, h('strong', null, a.id), badge(a.status as Status)), a.hasImage ? h('img', { src: imgUrl(a.id), alt: a.id }) : h('p', { class: 'muted' }, 'pas d’image'));

  function setBusy(b: boolean): void {
    busy = b;
    genBtn.disabled = b;
    for (const btn of grid.querySelectorAll('button')) btn.disabled = b;
  }

  async function generate(variantOf?: number): Promise<void> {
    if (!current || busy) return;
    setBusy(true);
    bar.style.width = '0';
    status.textContent = 'Démarrage…';
    const references = refs.value.split(',').map((s) => s.trim()).filter(Boolean);
    const n = variantOf ? 1 : Math.max(1, Math.min(16, Number(count.value) || 1));
    const onEvent = (e: GenEvent): void => {
      if (e.type === 'progress') {
        const frac = ((e.index ?? 0) + (e.max ? (e.value ?? 0) / e.max : e.phase === 'done' ? 1 : 0)) / (e.total ?? 1);
        bar.style.width = `${Math.round(Math.min(1, frac) * 100)}%`;
        status.textContent = `Candidat ${(e.index ?? 0) + 1}/${e.total} : ${e.phase}${e.max ? ` ${e.value}/${e.max}` : ''}`;
      } else if (e.type === 'candidate' && e.candidate) {
        cands.push(e.candidate);
        render(grid, [...cands].reverse().map(candidateCard));
        setBusy(true);
      }
    };
    try {
      const done = await imagesApi.generate(
        {
          assetId: current,
          n,
          ...(prompt.value.trim() ? { prompt: prompt.value.trim() } : {}),
          ...(workflow.value.trim() ? { workflow: workflow.value.trim() } : {}),
          references,
          ...(seed.value !== '' ? { seed: Number(seed.value) } : {}),
          ...(variantOf ? { variantOf } : {}),
        },
        onEvent,
      );
      if (done.ok) {
        status.textContent = 'Terminé.';
        bar.style.width = '100%';
      } else {
        status.textContent = '';
        toast(done.error ?? 'Échec de la génération', 'err');
        const s = document.createElement('span');
        s.className = 'err-text';
        s.textContent = done.error ?? '';
        status.replaceChildren(s);
      }
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
      await refreshAssets();
    }
  }

  async function selectCandidate(n: number): Promise<void> {
    if (!current) return;
    const r = await imagesApi.select(current, n);
    if (r.ok) {
      bust.set(current, Date.now());
      toast(`${current} : candidat #${n} retenu (statut « à relire »)`);
    } else toast(r.error ?? 'Sélection impossible', 'err');
    await refreshAssets();
  }

  async function validate(id: string): Promise<void> {
    const r = await imagesApi.validate(id);
    if (r.ok) toast(`${id} validé`);
    else toast(r.error ?? 'Validation impossible', 'err');
    await refreshAssets();
  }

  async function ping(): Promise<void> {
    const c = await imagesApi.comfyui();
    const box = document.getElementById('comfy-status');
    if (box) box.textContent = c.ok ? `ComfyUI : ${c.url} (connecté)` : `ComfyUI injoignable : ${c.url}`;
  }

  return {
    el,
    update(): void {
      if (!el.hidden) void refreshAssets();
    },
    onShow(): void {
      void ping();
      void refreshAssets();
    },
  };
}
