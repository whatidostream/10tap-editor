// COPY of InfiniKan apps/shared/src/editor/sectionDocument.ts (the fork builds alone); keep in step:
// the InfiniKan unit test writing-section-document compares the two.
/* eslint-disable */
/**
 * The Writing view's ONE rich-text document (plans/writing-view-and-settings-templates.md
 * §A3, D2): an item and its subtree as nested `ikSection` nodes in a single TipTap
 * editor, on web / desktop (TipTap) and the phones (TenTap's WebView, a copy of this
 * file in the 10tap-editor fork, as with richTextRadio.ts).
 *
 *   doc            → ikSection+
 *   ikSection      → ikSectionTitle ikSectionBody? ikSection*     attrs: itemId, open, parked, parkedLabel
 *   ikSectionTitle → text*            (plain: a title has no marks)   attrs: scene
 *   ikSectionBody  → block+           (the item's description, as rich text)
 *
 * Memory (the reason for D2): only OPEN sections hold their body. A closed section is
 * its title alone; its body is put in when it opens (`openSection`) and taken out when
 * it closes (`closeSection`), so the document never holds the whole book.
 *
 * Parked (the phones' text window, writing/writingWindow): a section that is OPEN in
 * the app but whose text is out of the editor for now, because it is far from the
 * caret and the screen. It keeps `open: true`, has no body, and shows a greyed line
 * (its `parkedLabel`, e.g. "… 820 words") after its title; `parkSection` takes the
 * text out and `openSection` puts it back. Both are LOADs: never edits, so a parked
 * section is never saved, and never saved as empty (`sectionEdits`, `sectionSavePatch`).
 *
 * Saving: `changedSections(tr)` maps a transaction's steps to the sections whose title
 * or body they touched, so each edit saves to ITS item through the normal per-item
 * offline queue. Structure (which sections exist, in what order, under which parent)
 * changes only through transactions marked `STRUCTURE_META` (moves / adds / deletes
 * issued as item actions); typing that would merge or delete a section is refused.
 *
 * Shared code imports no packages: the app passes TipTap's Node / Extension and
 * ProseMirror's Plugin / PluginKey in, the way createRadioListExtensions does.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const SECTION_NODE = 'ikSection';
export const SECTION_TITLE_NODE = 'ikSectionTitle';
export const SECTION_BODY_NODE = 'ikSectionBody';
/** Transaction meta: this transaction may change the section structure. */
export const STRUCTURE_META = 'ikSectionStructure';
/** Transaction meta: content loaded from the store (open / sync swap) — not an edit to save. */
export const LOAD_META = 'ikSectionLoad';

// ---------------------------------------------------------------------------
// Building the document
// ---------------------------------------------------------------------------

/** One node of the outline the view shows (built from the item store). */
export interface SectionOutline {
  itemId: string;
  title: string;
  open: boolean;
  children: SectionOutline[];
  /** The title is a screenplay scene heading (writing/fountain fountainTitleRole): styled as one. */
  scene?: boolean;
  /** Open, but its text is kept out of the editor for now (see Parked above). */
  parked?: boolean;
  /** The greyed line a parked section shows (the app's translated "… 820 words"). */
  parkedLabel?: string;
}

/** The class a scene title carries (the Writing view's preview uses the same one). */
export const SCENE_TITLE_CLASS = 'ik-section__title--scene';

/** ProseMirror JSON for a section title. */
function titleJSON(title: string, scene = false): any {
  const node: any = { type: SECTION_TITLE_NODE };
  if (scene) node.attrs = { scene: true };
  if (title) node.content = [{ type: 'text', text: title }];
  return node;
}

/** A body's JSON from its block content; an empty body is one empty paragraph. */
export function bodyJSON(blocks: any[] | null | undefined): any {
  const content = Array.isArray(blocks) && blocks.length ? blocks : [{ type: 'paragraph' }];
  return { type: SECTION_BODY_NODE, content };
}

/**
 * The document JSON for an outline. `bodyFor(itemId)` gives an OPEN section's body
 * blocks (ProseMirror JSON, e.g. from the app's markdown→HTML→JSON path); closed
 * sections get no body at all.
 */
export function buildSectionDocJSON(outline: SectionOutline[], bodyFor: (itemId: string) => any[] | null): any {
  const section = (node: SectionOutline): any => {
    const content: any[] = [titleJSON(node.title, !!node.scene)];
    const parked = !!node.open && !!node.parked;
    if (node.open && !parked) content.push(bodyJSON(bodyFor(node.itemId)));
    for (const child of node.children) content.push(section(child));
    const attrs: any = { itemId: node.itemId, open: !!node.open };
    if (parked) { attrs.parked = true; attrs.parkedLabel = node.parkedLabel || null; }
    return { type: SECTION_NODE, attrs, content };
  };
  // An empty outline still needs one section for `doc → ikSection+`; the view never
  // builds one (it shows the item itself as the top section).
  return { type: 'doc', content: outline.map(section) };
}

// ---------------------------------------------------------------------------
// Reading the document
// ---------------------------------------------------------------------------

/** Every section in document order: its position, depth (1 = top) and node. */
export function listSections(doc: any): Array<{ pos: number; depth: number; node: any; parentId: string | null }> {
  const out: Array<{ pos: number; depth: number; node: any; parentId: string | null }> = [];
  const walk = (node: any, base: number, depth: number, parentId: string | null) => {
    node.forEach((child: any, offset: number) => {
      if (child.type.name !== SECTION_NODE) return;
      const pos = base + offset;
      out.push({ pos, depth, node: child, parentId });
      walk(child, pos + 1, depth + 1, child.attrs.itemId);
    });
  };
  walk(doc, 0, 1, null);
  return out;
}

/** Where the section for `itemId` is, or null. */
export function findSection(doc: any, itemId: string): { pos: number; node: any } | null {
  let found: { pos: number; node: any } | null = null;
  doc.descendants((node: any, pos: number) => {
    if (found) return false;
    if (node.type.name === SECTION_NODE) {
      if (node.attrs.itemId === itemId) { found = { pos, node }; return false; }
      return true;
    }
    return false; // never look inside titles / bodies
  });
  return found;
}

/** A section's title text and body node (null when closed or parked). */
export function readSection(sectionNode: any): { title: string; body: any | null } {
  let title = '';
  let body: any = null;
  sectionNode.forEach((child: any) => {
    if (child.type.name === SECTION_TITLE_NODE) title = child.textContent;
    else if (child.type.name === SECTION_BODY_NODE) body = child;
  });
  return { title, body };
}

/** Whether a section is open but parked (its text out of the editor for now). */
export function isSectionParked(doc: any, itemId: string): boolean {
  const hit = findSection(doc, itemId);
  return !!hit && !!hit.node.attrs.open && !!hit.node.attrs.parked;
}

/**
 * What to save for each changed section, read from the document: its title, and its
 * body node ONLY when the section holds one. A section with no body (closed or
 * parked) never reports a body change, whatever `changed` says, so its text can
 * never be saved as empty.
 */
export function sectionEdits(
  doc: any,
  changed: Map<string, { title: boolean; body: boolean }>,
): Array<{ itemId: string; title: string; body: any | null; titleChanged: boolean; bodyChanged: boolean }> {
  const out: Array<{ itemId: string; title: string; body: any | null; titleChanged: boolean; bodyChanged: boolean }> = [];
  changed.forEach((parts, itemId) => {
    const hit = findSection(doc, itemId);
    if (!hit) return;
    const { title, body } = readSection(hit.node);
    const bodyChanged = !!parts.body && !!body;
    if (!parts.title && !bodyChanged) return;
    out.push({ itemId, title, body: bodyChanged ? body : null, titleChanged: !!parts.title, bodyChanged });
  });
  return out;
}

/**
 * The item patch for one reported edit (the app's save): the title when it changed,
 * the description only when the BODY changed and came with its text. `markdown` is
 * the body as markdown, or null when the page sent none (a parked or closed section,
 * a title-only edit): then the description is never touched.
 */
export function sectionSavePatch(
  current: { title?: string | null; description?: string | null },
  edit: { title: string; titleChanged: boolean; bodyChanged: boolean; markdown: string | null },
): { title?: string; description?: string } {
  const patch: { title?: string; description?: string } = {};
  if (edit.titleChanged && edit.title !== (current.title || '')) patch.title = edit.title;
  if (edit.bodyChanged && typeof edit.markdown === 'string') {
    const md = edit.markdown.trim();
    if (md !== String(current.description || '').trim()) patch.description = md;
  }
  return patch;
}

/** The structure as a string: ids with their parents, in order (cheap to compare). */
export function structureSignature(doc: any): string {
  return listSections(doc).map((s) => `${s.parentId || ''}>${s.node.attrs.itemId}`).join('|');
}

/**
 * The sections a transaction changed, and which part of each: `title`, `body`, or
 * both. Steps are mapped onto the NEW document; a changed range is charged to the
 * innermost section around it. Load transactions (LOAD_META) report nothing.
 */
export function changedSections(tr: any): Map<string, { title: boolean; body: boolean }> {
  const changed = new Map<string, { title: boolean; body: boolean }>();
  if (!tr.docChanged || tr.getMeta(LOAD_META)) return changed;
  const doc = tr.doc;
  const ranges: Array<[number, number]> = [];
  tr.mapping.maps.forEach((map: any, i: number) => {
    // Map each step's touched range through the REST of the steps, onto tr.doc.
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_oldStart: number, _oldEnd: number, newStart: number, newEnd: number) => {
      ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)]);
    });
  });
  const charge = (pos: number) => {
    const at = Math.max(0, Math.min(pos, doc.content.size));
    const $pos = doc.resolve(at);
    let part: 'title' | 'body' | null = null;
    for (let d = $pos.depth; d > 0; d -= 1) {
      const node = $pos.node(d);
      const name = node.type.name;
      if (name === SECTION_TITLE_NODE) part = 'title';
      else if (name === SECTION_BODY_NODE) part = part || 'body';
      else if (name === SECTION_NODE) {
        if (!part) return; // between parts: structure, not text
        const id = node.attrs.itemId;
        const entry = changed.get(id) || { title: false, body: false };
        entry[part] = true;
        changed.set(id, entry);
        return;
      }
    }
  };
  for (const [from, to] of ranges) {
    charge(from);
    if (to !== from) charge(to);
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Opening / closing (lazy bodies)
// ---------------------------------------------------------------------------

/**
 * Replace the whole document with a freshly built one (the view opening, or a
 * structure change from the store: a move, add or delete). A LOAD with STRUCTURE_META,
 * so the guard lets it through and nothing is reported as an edit. Plain
 * `setContent` is refused by the guard, on purpose.
 */
export function loadSectionDocument(tr: any, docJSON: any): any {
  const schema = tr.doc.type.schema;
  const next = schema.nodeFromJSON(docJSON);
  tr.replaceWith(0, tr.doc.content.size, next.content);
  tr.setMeta(LOAD_META, true);
  tr.setMeta(STRUCTURE_META, true);
  tr.setMeta('addToHistory', false);
  return tr;
}

/** Put a body into a closed or parked section (a LOAD transaction: nothing to save). */
export function openSection(tr: any, itemId: string, blocks: any[] | null): boolean {
  const hit = findSection(tr.doc, itemId);
  if (!hit) return false;
  const { node, pos } = hit;
  const schema = tr.doc.type.schema;
  if (!readSection(node).body) {
    const title = node.firstChild;
    const body = schema.nodeFromJSON(bodyJSON(blocks));
    tr.insert(pos + 1 + title.nodeSize, body);
  }
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: true, parked: false, parkedLabel: null });
  tr.setMeta(LOAD_META, true);
  tr.setMeta(STRUCTURE_META, true);
  tr.setMeta('addToHistory', false);
  return true;
}

/**
 * Take a section's body out. The caller saves it first if it was changed
 * (`changedSections` told it so); after this the text lives only in the store.
 */
export function closeSection(tr: any, itemId: string): boolean {
  const hit = findSection(tr.doc, itemId);
  if (!hit) return false;
  const { node, pos } = hit;
  let bodyAt = -1;
  let bodySize = 0;
  node.forEach((child: any, childOffset: number) => {
    if (child.type.name === SECTION_BODY_NODE) { bodyAt = childOffset; bodySize = child.nodeSize; }
  });
  if (bodyAt >= 0) tr.delete(pos + 1 + bodyAt, pos + 1 + bodyAt + bodySize);
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: false, parked: false, parkedLabel: null });
  tr.setMeta(LOAD_META, true);
  tr.setMeta(STRUCTURE_META, true);
  tr.setMeta('addToHistory', false);
  return true;
}

/**
 * Park an open (or closed) section: its text leaves the editor, it stays OPEN, and it
 * shows `label` after its title until `openSection` loads it again. A LOAD: the
 * caller saves the body first if it was changed (the page flushes what is waiting),
 * and nothing here is ever reported as an edit. A label change alone also goes
 * through here.
 */
export function parkSection(tr: any, itemId: string, label: string | null): boolean {
  const hit = findSection(tr.doc, itemId);
  if (!hit) return false;
  const { node, pos } = hit;
  let bodyAt = -1;
  let bodySize = 0;
  node.forEach((child: any, childOffset: number) => {
    if (child.type.name === SECTION_BODY_NODE) { bodyAt = childOffset; bodySize = child.nodeSize; }
  });
  if (bodyAt < 0 && node.attrs.open && node.attrs.parked && node.attrs.parkedLabel === (label || null)) return false;
  if (bodyAt >= 0) tr.delete(pos + 1 + bodyAt, pos + 1 + bodyAt + bodySize);
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: true, parked: true, parkedLabel: label || null });
  tr.setMeta(LOAD_META, true);
  tr.setMeta(STRUCTURE_META, true);
  tr.setMeta('addToHistory', false);
  return true;
}

/** Replace an open section's body with new blocks (a sync swap: LOAD, not an edit). */
export function replaceSectionBody(tr: any, itemId: string, blocks: any[] | null): boolean {
  const hit = findSection(tr.doc, itemId);
  if (!hit) return false;
  const { node, pos } = hit;
  const schema = tr.doc.type.schema;
  let done = false;
  node.forEach((child: any, childOffset: number) => {
    if (done || child.type.name !== SECTION_BODY_NODE) return;
    const from = pos + 1 + childOffset;
    tr.replaceWith(from, from + child.nodeSize, schema.nodeFromJSON(bodyJSON(blocks)));
    done = true;
  });
  if (done) { tr.setMeta(LOAD_META, true); tr.setMeta('addToHistory', false); }
  return done;
}

/** Replace a section's title text (a sync or rename from elsewhere: LOAD, not an edit). */
export function replaceSectionTitle(tr: any, itemId: string, title: string): boolean {
  const hit = findSection(tr.doc, itemId);
  if (!hit) return false;
  const { node, pos } = hit;
  const titleNode = node.firstChild;
  if (!titleNode || titleNode.type.name !== SECTION_TITLE_NODE) return false;
  const schema = tr.doc.type.schema;
  tr.replaceWith(pos + 1, pos + 1 + titleNode.nodeSize, schema.nodeFromJSON(titleJSON(title, !!titleNode.attrs?.scene)));
  tr.setMeta(LOAD_META, true);
  tr.setMeta('addToHistory', false);
  return true;
}

/** Whether a section's title is drawn as a scene heading. */
export function sectionTitleScene(doc: any, itemId: string): boolean | null {
  const hit = findSection(doc, itemId);
  const titleNode = hit?.node.firstChild;
  if (!titleNode || titleNode.type.name !== SECTION_TITLE_NODE) return null;
  return !!titleNode.attrs?.scene;
}

/**
 * Mark a section's title as a scene heading or not (its format or its role
 * changed): the attribute only, so the text, the cursor and undo are untouched
 * (LOAD, not an edit). False when there is nothing to change.
 */
export function setSectionTitleScene(tr: any, itemId: string, scene: boolean): boolean {
  const hit = findSection(tr.doc, itemId);
  if (!hit) return false;
  const titleNode = hit.node.firstChild;
  if (!titleNode || titleNode.type.name !== SECTION_TITLE_NODE) return false;
  if (!!titleNode.attrs?.scene === !!scene) return false;
  tr.setNodeMarkup(hit.pos + 1, undefined, { ...titleNode.attrs, scene: !!scene });
  tr.setMeta(LOAD_META, true);
  tr.setMeta('addToHistory', false);
  return true;
}

// ---------------------------------------------------------------------------
// The TipTap extensions
// ---------------------------------------------------------------------------

export interface SectionExtensionDeps {
  Node: any;       // @tiptap/core Node
  Extension: any;  // @tiptap/core Extension
  Plugin: any;     // @tiptap/pm/state Plugin
  PluginKey: any;  // @tiptap/pm/state PluginKey
  /** The page's document (`window.document`), for the fold button's node view.
   *  Shared code never touches the DOM itself; without it sections render plain. */
  dom?: { createElement: (tag: string) => any };
  /** ProseMirror's Decoration / DecorationSet (@tiptap/pm/view), for a parked
   *  section's greyed line; without them (or `dom`) a parked section shows its title only. */
  Decoration?: any;
  DecorationSet?: any;
}

export interface SectionExtensionOptions {
  /** A section's title or body was edited (debounce and save on the app side). */
  onChange?: (changed: Map<string, { title: boolean; body: boolean }>, doc: any) => void;
  /** The fold arrow was pressed: the app loads / saves the body and calls open/closeSection. */
  onToggle?: (itemId: string, open: boolean) => void;
  /** The ⋯ button was pressed: the app opens the item's normal context menu there. */
  onMenu?: (itemId: string, anchor: any) => void;
  /** A press began on the drag handle: the app starts its shared-dnd drag of the item. */
  onDragStart?: (itemId: string, event: any, handle: any) => void;
  /** A parked section's greyed line was tapped: the app loads its text (`openSection`). */
  onUnpark?: (itemId: string) => void;
  /** Greyed text for a title with nothing in it (the app's translated "Untitled"). */
  untitledLabel?: string;
  /**
   * "+ Add item at top" / "+ Add item" inside each open section that has sections under
   * it (the Writing view's writing.addBoxes): read on every rebuild, so the app can turn
   * them on and off and then call `refreshAddBoxes(editor)`. Not part of the document.
   */
  addBoxes?: () => boolean;
  /** The boxes' labels (translated). */
  addLabels?: { top: string; bottom: string };
  /** A box was pressed: the app adds an item first (top) or last (bottom) under `itemId`. */
  onAdd?: (itemId: string, where: 'top' | 'bottom') => void;
}

/** The meta that makes the add boxes redraw (after the app turns them on or off). */
export const ADD_BOXES_META = 'ikSectionAddBoxes';

/** Redraw the add boxes now (`editor` is the TipTap editor). */
export function refreshAddBoxes(editor: any): void {
  if (!editor || !editor.view) return;
  editor.view.dispatch(editor.state.tr.setMeta(ADD_BOXES_META, true));
}

/** The heading level of a title: H1 for the view's top item, one more per level, H6 at most. */
export function sectionHeadingLevel(depth: number): number {
  return Math.max(1, Math.min(6, Math.floor(depth) || 1));
}

/**
 * The extensions for the section document. Use with the app's normal StarterKit
 * (minus its Document) and pass `SectionDocument` as the document node.
 *
 * Each section line (§A3b of the plan): the drag handle and the fold arrow sit in
 * the LEFT MARGIN of the first line (`.ik-section__gutter`, absolutely placed by the
 * app's CSS so the text never moves right), and a ⋯ button at the right end
 * (`.ik-section__menu`). None of them are part of the document.
 */
export function createSectionExtensions(deps: SectionExtensionDeps, options: SectionExtensionOptions = {}): any[] {
  const { Node, Extension, Plugin, PluginKey, dom: domPort, Decoration, DecorationSet } = deps;

  const SectionDocument = Node.create({
    name: 'doc',
    topNode: true,
    content: `${SECTION_NODE}+`,
  });

  const control = (tag: string, className: string, label: string): any => {
    const el = domPort!.createElement(tag);
    if (tag === 'button') el.type = 'button';
    el.className = className;
    el.contentEditable = 'false';
    el.setAttribute('aria-label', label);
    return el;
  };

  const Section = Node.create({
    name: SECTION_NODE,
    content: `${SECTION_TITLE_NODE} ${SECTION_BODY_NODE}? ${SECTION_NODE}*`,
    defining: true,
    isolating: true,
    selectable: false,
    draggable: false,
    addAttributes() {
      return {
        itemId: { default: null, parseHTML: (el: any) => el.getAttribute('data-item-id'), renderHTML: (a: any) => ({ 'data-item-id': a.itemId }) },
        open: { default: false, parseHTML: (el: any) => el.getAttribute('data-open') === 'true', renderHTML: (a: any) => ({ 'data-open': a.open ? 'true' : 'false' }) },
        parked: { default: false, parseHTML: (el: any) => el.getAttribute('data-parked') === 'true', renderHTML: (a: any) => (a.parked ? { 'data-parked': 'true' } : {}) },
        parkedLabel: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
      };
    },
    parseHTML() { return [{ tag: 'section[data-ik-section]' }]; },
    renderHTML({ HTMLAttributes }: any) {
      return ['section', { ...HTMLAttributes, 'data-ik-section': '', class: 'ik-section' }, 0];
    },
    addNodeView() {
      if (!domPort) return null as any;
      return ({ node, getPos, editor }: any) => {
        const dom = domPort.createElement('section');
        dom.className = 'ik-section';
        dom.setAttribute('data-ik-section', '');
        const gutter = control('span', 'ik-section__gutter', '');
        gutter.removeAttribute('aria-label');
        const handle = control('span', 'ik-section__handle', 'Drag');
        handle.textContent = '⠿';
        const fold = control('button', 'ik-section__fold', 'Fold');
        gutter.appendChild(handle);
        gutter.appendChild(fold);
        const menu = control('button', 'ik-section__menu', 'Menu');
        menu.textContent = '⋯';
        const content = domPort.createElement('div');
        content.className = 'ik-section__content';
        dom.appendChild(gutter);
        dom.appendChild(menu);
        dom.appendChild(content);
        let current = node;
        const depth = () => {
          if (typeof getPos !== 'function' || !editor) return 1;
          try { return editor.state.doc.resolve(getPos()).depth + 1; } catch { return 1; }
        };
        const paint = () => {
          dom.setAttribute('data-item-id', current.attrs.itemId || '');
          dom.setAttribute('data-open', current.attrs.open ? 'true' : 'false');
          dom.setAttribute('data-parked', current.attrs.parked ? 'true' : 'false');
          dom.setAttribute('data-depth', String(depth()));
          fold.textContent = current.attrs.open ? '▾' : '▸';
          fold.setAttribute('aria-expanded', current.attrs.open ? 'true' : 'false');
        };
        paint();
        const keep = (e: any) => e.preventDefault(); // never move the text cursor
        fold.addEventListener('mousedown', keep);
        menu.addEventListener('mousedown', keep);
        fold.addEventListener('click', (e: any) => {
          e.preventDefault();
          options.onToggle?.(current.attrs.itemId, !current.attrs.open);
        });
        menu.addEventListener('click', (e: any) => {
          e.preventDefault();
          options.onMenu?.(current.attrs.itemId, menu);
        });
        handle.addEventListener('pointerdown', (e: any) => {
          e.preventDefault();
          options.onDragStart?.(current.attrs.itemId, e, handle);
        });
        const isControl = (t: any) => t === gutter || t === menu || gutter.contains(t) || menu.contains(t);
        return {
          dom,
          contentDOM: content,
          update: (next: any) => {
            if (next.type.name !== SECTION_NODE) return false;
            current = next;
            paint();
            return true;
          },
          stopEvent: (e: any) => isControl(e.target),
          ignoreMutation: (m: any) => isControl(m.target),
        };
      };
    },
  });

  const SectionTitle = Node.create({
    name: SECTION_TITLE_NODE,
    content: 'text*',
    marks: '',
    defining: true,
    addAttributes() {
      return {
        // A screenplay scene's title (fountain): drawn as the scene heading.
        scene: {
          default: false,
          parseHTML: (el: any) => !!el.classList?.contains(SCENE_TITLE_CLASS),
          renderHTML: () => ({}),
        },
      };
    },
    parseHTML() {
      return [1, 2, 3, 4, 5, 6].map((n) => ({ tag: `h${n}[data-ik-section-title]` }));
    },
    renderHTML({ node }: any) {
      return ['h2', { 'data-ik-section-title': '', class: node.attrs?.scene ? `ik-section__title ${SCENE_TITLE_CLASS}` : 'ik-section__title' }, 0];
    },
    addNodeView() {
      if (!domPort) return null as any;
      // The heading level follows the section's depth (H1 for the view's top item).
      return ({ node, getPos, editor }: any) => {
        const levelNow = () => {
          if (typeof getPos !== 'function' || !editor) return 2;
          try { return sectionHeadingLevel(editor.state.doc.resolve(getPos()).depth); } catch { return 2; }
        };
        const level = levelNow();
        const dom = domPort.createElement(`h${level}`);
        dom.className = 'ik-section__title';
        dom.setAttribute('data-ik-section-title', '');
        dom.setAttribute('data-placeholder', options.untitledLabel || 'Untitled');
        const mark = (n: any) => {
          dom.classList.toggle('is-empty', n.content.size === 0);
          dom.classList.toggle(SCENE_TITLE_CLASS, !!n.attrs?.scene);
        };
        mark(node);
        return {
          dom,
          contentDOM: dom,
          update: (next: any) => {
            if (next.type.name !== SECTION_TITLE_NODE) return false;
            if (levelNow() !== level) return false; // moved to another depth: redraw
            mark(next);
            return true;
          },
        };
      };
    },
  });

  const SectionBody = Node.create({
    name: SECTION_BODY_NODE,
    content: 'block+', // never empty: an open section always has a line to type in
    defining: true,
    isolating: true,
    parseHTML() { return [{ tag: 'div[data-ik-section-body]' }]; },
    renderHTML() { return ['div', { 'data-ik-section-body': '', class: 'ik-section__body' }, 0]; },
  });

  // A parked section's greyed line ("… 820 words"), after its title: a widget, so it
  // is never part of the text. Rebuilt on loads and structure changes (the only
  // transactions that park or load), mapped through typing.
  const parkedKey = new PluginKey('ikSectionsParked');
  const parkedDecorations = (doc: any): any => {
    const decos: any[] = [];
    for (const s of listSections(doc)) {
      const attrs = s.node.attrs;
      if (!attrs.open || !attrs.parked) continue;
      const id = attrs.itemId;
      const label = attrs.parkedLabel || '…';
      const at = s.pos + 1 + s.node.firstChild.nodeSize;
      decos.push(Decoration.widget(at, () => {
        const el = domPort!.createElement('div');
        el.className = 'ik-section__parked';
        el.contentEditable = 'false';
        el.setAttribute('data-item-id', id);
        el.setAttribute('role', 'button');
        el.textContent = label;
        el.addEventListener('mousedown', (e: any) => e.preventDefault());
        el.addEventListener('click', (e: any) => { e.preventDefault(); options.onUnpark?.(id); });
        return el;
      }, { key: `parked:${id}:${label}`, side: -1, ignoreSelection: true, stopEvent: () => true }));
    }
    return DecorationSet.create(doc, decos);
  };
  const parkedPlugins = Decoration && DecorationSet && domPort ? [new Plugin({
    key: parkedKey,
    state: {
      init: (_config: any, state: any) => parkedDecorations(state.doc),
      apply: (tr: any, old: any) => {
        if (!tr.docChanged) return old;
        if (tr.getMeta(LOAD_META) || tr.getMeta(STRUCTURE_META)) return parkedDecorations(tr.doc);
        return old.map(tr.mapping, tr.doc);
      },
    },
    props: { decorations: (state: any) => parkedKey.getState(state) },
  })] : [];

  // The add boxes (writing.addBoxes): a widget before an open section's first section and one
  // after its last, so they never become text. Rebuilt on loads, structure changes, opening
  // or closing and ADD_BOXES_META; mapped through typing.
  const addKey = new PluginKey('ikSectionsAdd');
  const addDecorations = (doc: any): any => {
    if (!options.addBoxes || !options.addBoxes()) return DecorationSet.empty;
    const decos: any[] = [];
    const box = (at: number, id: string, where: 'top' | 'bottom', side: number) => decos.push(Decoration.widget(at, () => {
      const el = domPort!.createElement('button');
      el.type = 'button';
      el.className = 'ik-writing-add';
      el.contentEditable = 'false';
      el.setAttribute('data-ik-add', `${id}|${where}`);
      el.setAttribute('data-testid', `writing-add-${where}-${id}`);
      el.textContent = `+ ${(where === 'top' ? options.addLabels?.top : options.addLabels?.bottom) || ''}`;
      el.addEventListener('mousedown', (e: any) => e.preventDefault());
      el.addEventListener('click', (e: any) => { e.preventDefault(); options.onAdd?.(id, where); });
      return el;
    }, { key: `add:${id}:${where}`, side, ignoreSelection: true, stopEvent: () => true }));
    for (const s of listSections(doc)) {
      if (s.depth < 2 || !s.node.attrs.open) continue;
      let first = -1;
      s.node.forEach((child: any, childOffset: number) => {
        if (child.type.name === SECTION_NODE && first < 0) first = childOffset;
      });
      if (first < 0) continue;
      const id = s.node.attrs.itemId;
      box(s.pos + 1 + first, id, 'top', -1);
      box(s.pos + s.node.nodeSize - 1, id, 'bottom', 1);
    }
    return DecorationSet.create(doc, decos);
  };
  const openSignature = (doc: any): string => listSections(doc).map((s) => (s.node.attrs.open ? '1' : '0')).join('');
  const addPlugins = Decoration && DecorationSet && domPort && options.onAdd ? [new Plugin({
    key: addKey,
    state: {
      init: (_config: any, state: any) => addDecorations(state.doc),
      apply: (tr: any, old: any, oldState: any) => {
        if (tr.getMeta(ADD_BOXES_META)) return addDecorations(tr.doc);
        if (!tr.docChanged) return old;
        // Off: nothing to keep up to date (and no walk of a long book on every key).
        if (!options.addBoxes || !options.addBoxes()) return DecorationSet.empty;
        if (tr.getMeta(LOAD_META) || tr.getMeta(STRUCTURE_META) || openSignature(tr.doc) !== openSignature(oldState.doc)) return addDecorations(tr.doc);
        return old.map(tr.mapping, tr.doc);
      },
    },
    props: { decorations: (state: any) => addKey.getState(state) },
  })] : [];

  const key = new PluginKey('ikSections');
  const SectionBehaviour = Extension.create({
    name: 'ikSectionBehaviour',
    addKeyboardShortcuts() {
      return {
        // Enter in a title goes to its body (an open section) instead of splitting it.
        Enter: ({ editor }: any) => {
          const { $from } = editor.state.selection;
          if ($from.parent.type.name !== SECTION_TITLE_NODE) return false;
          const section = $from.node($from.depth - 1);
          const sectionPos = $from.before($from.depth - 1);
          const title = section.firstChild;
          const next = section.childCount > 1 ? section.child(1) : null;
          if (next && next.type.name === SECTION_BODY_NODE) {
            const inside = sectionPos + 1 + title.nodeSize + 2; // into body → first block
            editor.commands.setTextSelection(inside);
            return true;
          }
          return true; // closed: Enter does nothing in a title
        },
      };
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key,
          // Typing never adds, deletes, merges or reorders sections.
          filterTransaction: (tr: any, state: any) => {
            if (!tr.docChanged || tr.getMeta(STRUCTURE_META)) return true;
            return structureSignature(tr.doc) === structureSignature(state.doc);
          },
          appendTransaction: (trs: any[], _old: any, state: any) => {
            if (!options.onChange) return null;
            const merged = new Map<string, { title: boolean; body: boolean }>();
            for (const tr of trs) {
              changedSections(tr).forEach((v, id) => {
                const m = merged.get(id) || { title: false, body: false };
                merged.set(id, { title: m.title || v.title, body: m.body || v.body });
              });
            }
            if (merged.size) options.onChange(merged, state.doc);
            return null;
          },
        }),
        ...parkedPlugins,
        ...addPlugins,
      ];
    },
  });

  return [SectionDocument, Section, SectionTitle, SectionBody, SectionBehaviour];
}
