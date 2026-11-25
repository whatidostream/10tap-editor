// COPY of InfiniKan apps/shared/src/editor/writingNodes.ts (the fork builds alone); keep in step:
// the InfiniKan unit test writing-richtext-roundtrip compares the two.
/* eslint-disable */
/**
 * Writing markdown in the RICH-TEXT editors (plans/writing-view-and-settings-templates.md
 * §B2): TipTap nodes and marks for maths, footnotes, CriticMarkup, sub / superscript,
 * highlight and escaped characters, so a note using that syntax survives being
 * opened and saved in Rich text exactly as typed.
 *
 *   $E=mc^2$  $$…$$            ikMath (inline atom)
 *   $$ ⏎ … ⏎ $$  ```math       ikMathBlock (block atom)
 *   [^1]                       ikFootnoteRef (inline atom)
 *   [^1]: note (+ indented)    ikFootnoteDef (block atom)
 *   {++…++} {--…--} {~~a~>b~~} {==…==}{>>…<<} {>>…<<}   ikCritic (inline atom)
 *   H~2~O  x^2^  ==text==      subscript / superscript / highlight marks
 *   \$ \~ \^ \= \{             ikEscape mark (the character stays text; saved escaped)
 *
 * Every atom carries its markdown SOURCE as typed (`data-source`); the converters
 * write it back unchanged (content/richTextWriting.ts). Marks are ordinary marks.
 *
 * Shared code imports no packages: the app passes TipTap's Node and Mark (and, for
 * the in-place views, a DOM port). The TenTap fork builds alone, so it keeps a
 * COPY of this file (10tap-editor/src/bridges/writingNodes.ts; unit
 * writing-richtext-roundtrip checks it is in step).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The attribute naming an atom's kind, and the one holding its source. */
export const WRITING_KIND_ATTR = 'data-ik-src';
export const WRITING_SOURCE_ATTR = 'data-source';
/** The attribute marking an escaped character (`\$` and friends). */
export const WRITING_ESCAPE_ATTR = 'data-ik-esc';

export type WritingAtomKind = 'math' | 'mathBlock' | 'footnoteRef' | 'footnoteDef' | 'critic';

/** Node name for each atom kind. */
export const WRITING_ATOM_NODES: Record<WritingAtomKind, string> = {
  math: 'ikMath',
  mathBlock: 'ikMathBlock',
  footnoteRef: 'ikFootnoteRef',
  footnoteDef: 'ikFootnoteDef',
  critic: 'ikCritic',
};

const BLOCK_KINDS: WritingAtomKind[] = ['mathBlock', 'footnoteDef'];

/** True for the block atoms (they sit between paragraphs). */
export function isBlockWritingKind(kind: string): boolean {
  return BLOCK_KINDS.includes(kind as WritingAtomKind);
}

/**
 * The atoms' look, for each app to add to its editor page once (theme colours
 * through CSS variables with neutral fallbacks).
 */
export const WRITING_NODE_CSS = `
.ik-wr { border-radius: 4px; cursor: pointer; }
.ik-wr:hover { background: rgba(127,127,127,.12); }
.ik-wr.ProseMirror-selectednode { outline: 2px solid var(--ik-wr-focus, rgba(80,140,255,.7)); }
span.ik-wr { padding: 0 1px; }
div.ik-wr { display: block; margin: .5em 0; padding: 2px 4px; }
.ik-wr--math .ik-wr__view:not([data-ik-math="done"]), .ik-wr--mathBlock .ik-wr__view:not([data-ik-math="done"]) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; white-space: pre-wrap;
  background: rgba(127,127,127,.12); border-radius: 3px; padding: 0 3px;
}
.ik-wr--mathBlock .ik-wr__view { display: block; text-align: center; overflow-x: auto; overflow-y: hidden; }
.ik-wr__fnref { font-size: .75em; color: var(--ik-wr-accent, #2f6fde); font-weight: 600; }
.ik-wr__fnref::before { content: "["; } .ik-wr__fnref::after { content: "]"; }
.ik-wr--footnoteDef { font-size: .9em; border-left: 3px solid rgba(127,127,127,.4); }
.ik-wr__fnlabel { font-weight: 600; margin-right: 6px; color: var(--ik-wr-accent, #2f6fde); }
.ik-wr__fnlabel::after { content: "."; }
.ik-wr ins.critic-ins { background: rgba(46,160,67,.18); text-decoration: underline; text-decoration-color: rgba(46,160,67,.9); color: inherit; }
.ik-wr del.critic-del { background: rgba(248,81,73,.15); text-decoration: line-through; text-decoration-color: rgba(220,50,40,.9); color: inherit; }
.ik-wr mark.critic-mark { background: rgba(255,214,10,.3); color: inherit; }
.ik-wr .critic-comment { display: inline-block; margin: 0 4px; padding: 0 6px; border-left: 3px solid rgba(127,127,127,.6); background: rgba(127,127,127,.12); border-radius: 3px; font-size: .85em; font-style: italic; }
.ik-wr__editor { display: inline-flex; gap: 4px; align-items: flex-start; flex-wrap: wrap; vertical-align: baseline; }
div.ik-wr > .ik-wr__editor { display: flex; }
.ik-wr__input { font: .9em ui-monospace, SFMono-Regular, Menlo, monospace; padding: 2px 4px; border: 1px solid var(--ik-wr-focus, rgba(80,140,255,.7)); border-radius: 4px; background: inherit; color: inherit; min-width: 4em; }
textarea.ik-wr__input { flex: 1 1 100%; width: 100%; resize: vertical; }
.ik-wr__btn { font: inherit; font-size: .8em; padding: 1px 8px; border-radius: 4px; border: 1px solid rgba(127,127,127,.5); background: rgba(127,127,127,.1); color: inherit; cursor: pointer; }
.ik-wr__accept { border-color: rgba(46,160,67,.8); }
.ik-wr__reject { border-color: rgba(220,50,40,.8); }
`;

/** The atom kinds' CriticMarkup sort, from the source: ins / del / sub / mark / comment. */
export function criticKindOf(source: string): 'ins' | 'del' | 'sub' | 'mark' | 'comment' | null {
  const s = String(source || '');
  if (/^\{\+\+[\s\S]*\+\+\}$/.test(s)) return 'ins';
  if (/^\{--[\s\S]*--\}$/.test(s)) return 'del';
  if (/^\{~~[\s\S]*~>[\s\S]*~~\}$/.test(s)) return 'sub';
  if (/^\{==[\s\S]*==\}(?:\{>>[\s\S]*<<\})?$/.test(s)) return 'mark';
  if (/^\{>>[\s\S]*<<\}$/.test(s)) return 'comment';
  return null;
}

export interface WritingExtensionDeps {
  /** TipTap's Node and Mark (from @tiptap/core or @tiptap/react). */
  Node: any;
  Mark: any;
  /**
   * The page's document (createElement): with it the atoms draw themselves
   * (typeset maths, footnote numbers, CriticMarkup as the preview shows it) and
   * open an in-place source editor on a click or tap. Without it they are chips
   * showing their source.
   */
  dom?: { createElement(tag: string): any };
  /** The app's lazy KaTeX loader (resolves to katex with mhchem). Without it maths shows its TeX. */
  loadKatex?: () => Promise<any>;
  /**
   * The text a CriticMarkup change becomes when accepted / rejected (shared
   * criticMarkup.ts acceptAllCritic / rejectAllCritic). Without it the source
   * editor offers no Accept / Reject.
   */
  resolveCritic?: (source: string, accept: boolean) => string;
}

/** The in-place editor's words (the app passes them translated). */
export interface WritingLabels {
  edit: string;
  done: string;
  accept: string;
  reject: string;
}

const DEFAULT_LABELS: WritingLabels = { edit: 'Edit', done: 'Done', accept: 'Accept', reject: 'Reject' };

export interface WritingExtensionOptions {
  /**
   * Add the `highlight` mark (default true). The phones' TenTap kit already has
   * TipTap's Highlight, which reads and writes the same <mark>.
   */
  highlight?: boolean;
  labels?: Partial<WritingLabels>;
}

// ── Reading an atom's source ────────────────────────────────────────────────

/** The TeX of a maths source (`$…$`, `$$…$$`, a `$$` block or a ```math fence). */
export function mathTexOf(source: string): { tex: string; display: boolean } {
  const s = String(source || '');
  const fence = /^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?[ \t]*\1[ \t]*$/.exec(s);
  if (fence) return { tex: fence[2] ?? '', display: true };
  if (s.startsWith('$$') && s.trimEnd().endsWith('$$') && s.trim().length >= 4) {
    return { tex: s.trim().slice(2, -2).trim(), display: true };
  }
  if (s.startsWith('$') && s.endsWith('$') && s.length >= 2) return { tex: s.slice(1, -1), display: false };
  return { tex: s, display: false };
}

/** A footnote's label (`[^label]` or `[^label]: …`). */
export function footnoteLabelOf(source: string): string {
  const m = /^\[\^([^\]\s]+)\]/.exec(String(source || ''));
  return m ? (m[1] ?? '') : '';
}

/** The parts of a CriticMarkup source, for drawing it. */
export function criticPartsOf(source: string): { kind: ReturnType<typeof criticKindOf>; text: string; next?: string; comment?: string } {
  const s = String(source || '');
  const kind = criticKindOf(s);
  let m: RegExpExecArray | null;
  if (kind === 'ins' || kind === 'del') return { kind, text: s.slice(3, -3) };
  if (kind === 'sub' && (m = /^\{~~([\s\S]*?)~>([\s\S]*)~~\}$/.exec(s))) return { kind, text: m[1] ?? '', next: m[2] ?? '' };
  if (kind === 'mark' && (m = /^\{==([\s\S]*?)==\}(?:\{>>([\s\S]*?)<<\})?$/.exec(s))) return { kind, text: m[1] ?? '', comment: m[2] };
  if (kind === 'comment') return { kind, text: '', comment: s.slice(3, -3) };
  return { kind, text: s };
}

/**
 * The extensions: five atoms and four marks (three without highlight). Add them
 * after StarterKit.
 */
export function createWritingExtensions(deps: WritingExtensionDeps, options: WritingExtensionOptions = {}): any[] {
  const { Node, Mark, dom: domPort, loadKatex, resolveCritic } = deps;
  const labels: WritingLabels = { ...DEFAULT_LABELS, ...(options.labels || {}) };

  const el = (tag: string, className?: string, text?: string): any => {
    const e = domPort!.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  /** Draw an atom's source the way the preview shows it. */
  const paint = (view: any, kind: WritingAtomKind, source: string) => {
    view.textContent = '';
    view.removeAttribute('data-ik-math');
    if (kind === 'math' || kind === 'mathBlock') {
      const { tex, display } = mathTexOf(source);
      view.textContent = source;
      if (!loadKatex || !tex.trim()) return;
      view.setAttribute('data-ik-math', 'pending');
      loadKatex().then((katex: any) => {
        if (view.getAttribute('data-ik-source') !== source) return; // edited meanwhile
        view.innerHTML = katex.renderToString(tex, { displayMode: display || kind === 'mathBlock', throwOnError: false, output: 'htmlAndMathml' });
        view.setAttribute('data-ik-math', 'done');
      }).catch(() => { view.setAttribute('data-ik-math', 'error'); });
      return;
    }
    if (kind === 'footnoteRef') {
      view.appendChild(el('sup', 'ik-wr__fnref', footnoteLabelOf(source) || source));
      return;
    }
    if (kind === 'footnoteDef') {
      // Consecutive definitions are one atom: a line per note.
      const notes = source.split(/\n(?=\[\^[^\]\s]+\]:)/);
      notes.forEach((note) => {
        const line = el('div', 'ik-wr__fndef');
        line.appendChild(el('span', 'ik-wr__fnlabel', footnoteLabelOf(note)));
        line.appendChild(domPort!.createElement('span')).textContent = note.replace(/^\[\^[^\]\s]+\]:[ \t]?/, '');
        view.appendChild(line);
      });
      return;
    }
    const parts = criticPartsOf(source);
    if (parts.kind === 'ins') view.appendChild(el('ins', 'critic-ins', parts.text));
    else if (parts.kind === 'del') view.appendChild(el('del', 'critic-del', parts.text));
    else if (parts.kind === 'sub') {
      view.appendChild(el('del', 'critic-del', parts.text));
      view.appendChild(el('ins', 'critic-ins', parts.next || ''));
    } else if (parts.kind === 'mark') {
      view.appendChild(el('mark', 'critic-mark', parts.text));
      if (parts.comment !== undefined) view.appendChild(el('span', 'critic-comment', parts.comment));
    } else if (parts.kind === 'comment') view.appendChild(el('span', 'critic-comment', parts.comment || ''));
    else view.textContent = source;
  };

  /**
   * The atom's view: drawn as the preview draws it; a click or tap opens a small
   * source editor in place (Enter, or ⌘/Ctrl+Enter in a block, keeps it; Escape
   * leaves it; emptied, the atom goes). CriticMarkup also gets Accept / Reject.
   */
  const nodeView = (kind: WritingAtomKind, tag: string) => ({ node, getPos, editor }: any) => {
    let current = node;
    let editing: any = null;
    const root = el(tag, `ik-wr ik-wr--${kind}`);
    root.setAttribute(WRITING_KIND_ATTR, kind);
    root.contentEditable = 'false';
    const view = el(tag === 'div' ? 'div' : 'span', 'ik-wr__view');
    root.appendChild(view);
    const draw = () => {
      root.setAttribute(WRITING_SOURCE_ATTR, current.attrs.source || '');
      if (kind === 'critic') root.setAttribute('data-critic', criticKindOf(current.attrs.source) || '');
      view.setAttribute('data-ik-source', current.attrs.source || '');
      paint(view, kind, current.attrs.source || '');
    };
    draw();

    const replaceWith = (text: string | null) => {
      if (typeof getPos !== 'function') return;
      const pos = getPos();
      if (typeof pos !== 'number') return;
      const { state } = editor.view;
      const tr = state.tr;
      if (text === null) tr.setNodeMarkup(pos, undefined, { ...current.attrs });
      else if (text) tr.replaceWith(pos, pos + current.nodeSize, state.schema.text(text));
      else tr.delete(pos, pos + current.nodeSize);
      editor.view.dispatch(tr);
    };
    const setSource = (value: string) => {
      if (typeof getPos !== 'function') return;
      const pos = getPos();
      if (typeof pos !== 'number') return;
      const tr = editor.view.state.tr;
      if (!value.trim()) tr.delete(pos, pos + current.nodeSize);
      else tr.setNodeMarkup(pos, undefined, { ...current.attrs, source: value });
      editor.view.dispatch(tr);
    };
    const close = (keep: boolean) => {
      if (!editing) return;
      const value = editing.input.value;
      editing.box.remove();
      editing = null;
      root.classList.remove('is-editing');
      view.style.display = '';
      if (keep && value !== current.attrs.source) setSource(value);
      editor?.commands?.focus?.();
    };
    const button = (label: string, className: string, onPress: () => void) => {
      const b = el('button', `ik-wr__btn ${className}`, label);
      b.type = 'button';
      b.addEventListener('mousedown', (e: any) => e.preventDefault()); // keep the input's focus
      b.addEventListener('click', (e: any) => { e.preventDefault(); e.stopPropagation(); onPress(); });
      return b;
    };
    const open = () => {
      if (editing || !editor?.isEditable) return;
      const source = current.attrs.source || '';
      const multiline = tag === 'div' || source.includes('\n');
      const box = el(tag === 'div' ? 'div' : 'span', 'ik-wr__editor');
      const input = el(multiline ? 'textarea' : 'input', 'ik-wr__input');
      if (!multiline) input.type = 'text';
      input.value = source;
      input.setAttribute('aria-label', labels.edit);
      input.setAttribute('spellcheck', 'false');
      if (multiline) input.rows = Math.min(12, Math.max(2, source.split('\n').length + 1));
      else input.size = Math.max(4, Math.min(60, source.length + 2));
      box.appendChild(input);
      box.appendChild(button(labels.done, 'ik-wr__done', () => close(true)));
      if (kind === 'critic' && resolveCritic && criticKindOf(source)) {
        const resolve = (accept: boolean) => {
          const text = resolveCritic(editing ? editing.input.value : source, accept);
          if (editing) { editing.box.remove(); editing = null; }
          replaceWith(text);
          editor?.commands?.focus?.();
        };
        box.appendChild(button(labels.accept, 'ik-wr__accept', () => resolve(true)));
        box.appendChild(button(labels.reject, 'ik-wr__reject', () => resolve(false)));
      }
      input.addEventListener('keydown', (e: any) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
        else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); close(true); }
      });
      input.addEventListener('blur', () => { setTimeout(() => { if (editing && editing.input === input) close(true); }, 0); });
      editing = { box, input };
      root.classList.add('is-editing');
      view.style.display = 'none';
      root.appendChild(box);
      input.focus();
      if (!multiline) input.select?.();
    };
    root.addEventListener('mousedown', (e: any) => {
      if (editing && editing.box.contains(e.target)) return;
      e.preventDefault();
    });
    root.addEventListener('click', (e: any) => {
      if (editing && editing.box.contains(e.target)) return;
      e.preventDefault();
      open();
    });
    return {
      dom: root,
      update: (next: any) => {
        if (next.type !== current.type) return false;
        current = next;
        if (!editing) draw();
        return true;
      },
      selectNode: () => root.classList.add('ProseMirror-selectednode'),
      deselectNode: () => root.classList.remove('ProseMirror-selectednode'),
      stopEvent: (e: any) => !!editing && editing.box.contains(e.target),
      ignoreMutation: () => true,
      destroy: () => { editing = null; },
    };
  };

  const atom = (kind: WritingAtomKind) => {
    const block = isBlockWritingKind(kind);
    const tag = block ? 'div' : 'span';
    return Node.create({
      name: WRITING_ATOM_NODES[kind],
      group: block ? 'block' : 'inline',
      inline: !block,
      atom: true,
      selectable: true,
      draggable: false,
      addAttributes() {
        return {
          source: {
            default: '',
            parseHTML: (el: any) => el.getAttribute(WRITING_SOURCE_ATTR) ?? el.textContent ?? '',
            renderHTML: (a: any) => ({ [WRITING_SOURCE_ATTR]: a.source }),
          },
        };
      },
      parseHTML() {
        return [{ tag: `${tag}[${WRITING_KIND_ATTR}="${kind}"]`, priority: 80 }];
      },
      renderHTML({ node, HTMLAttributes }: any) {
        return [tag, { ...HTMLAttributes, [WRITING_KIND_ATTR]: kind, class: `ik-wr ik-wr--${kind}` }, node.attrs.source || ''];
      },
      renderText({ node }: any) {
        return node.attrs.source || '';
      },
      addNodeView() {
        if (!domPort) return null as any;
        return nodeView(kind, tag);
      },
    });
  };

  const Subscript = Mark.create({
    name: 'subscript',
    excludes: 'superscript',
    parseHTML() { return [{ tag: 'sub' }]; },
    renderHTML() { return ['sub', 0]; },
  });

  const Superscript = Mark.create({
    name: 'superscript',
    excludes: 'subscript',
    parseHTML() { return [{ tag: 'sup' }]; },
    renderHTML() { return ['sup', 0]; },
  });

  const Highlight = Mark.create({
    name: 'highlight',
    parseHTML() { return [{ tag: 'mark' }]; },
    renderHTML() { return ['mark', 0]; },
  });

  // An escaped character stays plain text in the editor; the mark only remembers
  // the backslash. Typing next to it never extends it.
  const Escape = Mark.create({
    name: 'ikEscape',
    inclusive: false,
    spanning: false,
    parseHTML() { return [{ tag: `span[${WRITING_ESCAPE_ATTR}]`, priority: 80 }]; },
    renderHTML() { return ['span', { [WRITING_ESCAPE_ATTR]: '' }, 0]; },
  });

  const out = [
    atom('math'), atom('mathBlock'), atom('footnoteRef'), atom('footnoteDef'), atom('critic'),
    Subscript, Superscript, Escape,
  ];
  if (options.highlight !== false) out.push(Highlight);
  return out;
}
