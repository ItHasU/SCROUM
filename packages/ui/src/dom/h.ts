/** Mini-hyperscript DOM (vanilla, sans framework). */

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener | Partial<CSSStyleDeclaration>>;

/**
 * `h('button.btn.primary', { onclick, 'aria-label': 'x' }, 'Texte')`.
 * Sélecteur : balise, puis `.classe` et `#id` optionnels.
 */
export function h<K extends keyof HTMLElementTagNameMap>(sel: K | `${K}${'.' | '#'}${string}`, attrs?: Attrs | null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K];
export function h(sel: string, attrs?: Attrs | null, ...children: (Child | Child[])[]): HTMLElement;
export function h(sel: string, attrs?: Attrs | null, ...children: (Child | Child[])[]): HTMLElement {
  const m = /^([a-z0-9-]+)?((?:[.#][^.#]+)*)$/i.exec(sel);
  const tag = m?.[1] || 'div';
  const el = document.createElement(tag);
  for (const part of (m?.[2] ?? '').match(/[.#][^.#]+/g) ?? []) {
    if (part.startsWith('.')) el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'class') el.className += (el.className ? ' ' : '') + String(v);
      else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

/** Remplace tout le contenu d'un élément. */
export function replace(el: Element, ...children: (Child | Child[])[]): void {
  el.replaceChildren();
  append(el, children);
}

/** Bouton standard (type=button). */
export function button(cls: string, label: Child | Child[], onclick: (ev: MouseEvent) => void, attrs: Attrs = {}): HTMLButtonElement {
  return h(`button${cls ? '.' + cls.split(' ').join('.') : ''}` as 'button', { type: 'button', onclick: onclick as EventListener, ...attrs }, label as Child);
}
