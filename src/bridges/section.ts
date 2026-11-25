// The page's DOM (this file's page half runs in the editor web view; the lib has no dom types).
declare const document: any;
declare const window: any;

import { Node, Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DOMParser as PMDOMParser, DOMSerializer } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import BridgeExtension from './base';
import {
  createSectionExtensions,
  buildSectionDocJSON,
  loadSectionDocument,
  openSection,
  closeSection,
  parkSection,
  sectionEdits,
  replaceSectionBody,
  replaceSectionTitle,
  setSectionTitleScene,
  findSection,
  readSection,
  SECTION_NODE,
  type SectionOutline,
} from './sectionDocumentNodes';

/**
 * InfiniKan fork: the Writing view's one-editor document (a section per item,
 * nested; only open sections hold their text). sectionDocumentNodes.ts is a
 * copy of InfiniKan's apps/shared/src/editor/sectionDocument.ts (its unit test
 * writing-section-document checks the copy is in step).
 *
 * Use it beside the start kit with the core bridge's document holding sections:
 *   [...TenTapStartKit.filter(b => b !== CoreBridge),
 *    CoreBridge.extendExtension({ content: 'ikSection+' }),
 *    SectionBridge.configureExtension({ untitledLabel })]
 * (the page builds the section nodes from that config; the bridge has no
 * tiptap extension of its own until then).
 *
 * App → editor: loadSections, openSection, closeSection, windowSections
 * (load / park many at once, for the text window), replaceSection,
 * requestSectionState. Editor → app (editor.sectionListener): section-changed
 * [{ itemId, title, html }], section-toggle, section-menu, section-drop,
 * section-state, section-viewport (the open sections on or near the screen,
 * and the caret's), section-unpark (a parked section's line was tapped).
 */

export enum SectionActionType {
  Load = 'section-load',
  Open = 'section-open',
  Close = 'section-close',
  Replace = 'section-replace',
  State = 'section-state-request',
  Window = 'section-window',
}

export enum SectionEditorMessageType {
  Changed = 'section-changed',
  Toggle = 'section-toggle',
  Menu = 'section-menu',
  Drop = 'section-drop',
  State = 'section-state',
  Viewport = 'section-viewport',
  Unpark = 'section-unpark',
}

export type SectionEditorMessage =
  | {
      type: SectionEditorMessageType.Changed;
      payload: Array<{
        itemId: string;
        title: string;
        html: string | null;
        titleChanged: boolean;
        bodyChanged: boolean;
      }>;
    }
  | {
      type: SectionEditorMessageType.Toggle;
      payload: { itemId: string; open: boolean };
    }
  | { type: SectionEditorMessageType.Menu; payload: { itemId: string } }
  | {
      type: SectionEditorMessageType.Drop;
      payload: {
        dragged: string;
        target: string;
        zone: 'before' | 'into' | 'after';
      };
    }
  | {
      type: SectionEditorMessageType.State;
      payload: { requestId: string; data: any };
    }
  | {
      type: SectionEditorMessageType.Viewport;
      payload: { near: string[]; cursor: string | null };
    }
  | { type: SectionEditorMessageType.Unpark; payload: { itemId: string } };

type SectionMessage =
  | {
      type: SectionActionType.Load;
      payload: { outline: SectionOutline[]; bodies: Record<string, string> };
    }
  | { type: SectionActionType.Open; payload: { itemId: string; html: string } }
  | { type: SectionActionType.Close; payload: { itemId: string } }
  | {
      type: SectionActionType.Replace;
      payload: {
        itemId: string;
        title?: string;
        html?: string;
        scene?: boolean;
      };
    }
  | { type: SectionActionType.State; payload: { requestId: string } }
  | {
      type: SectionActionType.Window;
      payload: {
        load: Array<{ itemId: string; html: string }>;
        park: Array<{ itemId: string; label: string }>;
        margin?: number;
      };
    }
  | SectionEditorMessage;

type SectionEditorInstance = {
  loadSections: (
    outline: SectionOutline[],
    bodies: Record<string, string>
  ) => void;
  openSection: (itemId: string, html: string) => void;
  closeSection: (itemId: string) => void;
  /** `scene`: the title is (or stops being) a screenplay scene heading. */
  replaceSection: (
    itemId: string,
    change: { title?: string; html?: string; scene?: boolean }
  ) => void;
  requestSectionState: (requestId: string) => void;
  /**
   * The text window: load these sections' text and park these (open, title and a
   * greyed label only), in one step that keeps what is on screen where it is.
   * `margin`: how many screen heights above and below count as near, for the
   * section-viewport reports the page sends from then on.
   */
  windowSections: (
    load: Array<{ itemId: string; html: string }>,
    park: Array<{ itemId: string; label: string }>,
    margin?: number
  ) => void;
  /** Set by the app: receives the editor's section messages. */
  sectionListener?: (message: SectionEditorMessage) => void;
};

declare module '../types/EditorBridge' {
  interface EditorBridge extends SectionEditorInstance {}
}

const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';

const post = (message: SectionEditorMessage) => {
  if (hasDom)
    (window as any).ReactNativeWebView?.postMessage(JSON.stringify(message));
};

// ---------------------------------------------------------------------------
// The page side (only runs in the editor's web view)
// ---------------------------------------------------------------------------

let currentEditor: any = null;
const pending = new Map<string, { title: boolean; body: boolean }>();
let flushTimer: any = null;
const CHANGE_DELAY_MS = 250;

function blocksFromHtml(schema: any, html: string): any[] {
  const el = document.createElement('div');
  el.innerHTML = html || '';
  const slice = PMDOMParser.fromSchema(schema).parseSlice(el);
  const out: any[] = [];
  slice.content.forEach((n: any) => {
    if (n.isBlock && n.type.name !== SECTION_NODE) out.push(n.toJSON());
    else if (n.isInline) out.push({ type: 'paragraph', content: [n.toJSON()] });
  });
  return out;
}

function htmlFromBody(schema: any, body: any): string | null {
  if (!body) return null;
  const el = document.createElement('div');
  el.appendChild(
    DOMSerializer.fromSchema(schema).serializeFragment(body.content)
  );
  return el.innerHTML;
}

function flushChanges() {
  clearTimeout(flushTimer);
  flushTimer = null;
  const ed = currentEditor;
  if (!ed || ed.isDestroyed || pending.size === 0) return;
  const out: Array<{
    itemId: string;
    title: string;
    html: string | null;
    titleChanged: boolean;
    bodyChanged: boolean;
  }> = [];
  // A section with no body (parked or closed) never reports a body: its text
  // is never sent as empty.
  sectionEdits(ed.state.doc, pending).forEach((edit) => {
    out.push({
      itemId: edit.itemId,
      title: edit.title,
      html: edit.bodyChanged ? htmlFromBody(ed.schema, edit.body) : null,
      titleChanged: edit.titleChanged,
      bodyChanged: edit.bodyChanged,
    });
  });
  pending.clear();
  if (out.length)
    post({ type: SectionEditorMessageType.Changed, payload: out });
}

function cursorSectionId(ed: any): string | null {
  const doc = ed.state.doc;
  const $from = doc.resolve(
    Math.min(ed.state.selection.from, doc.content.size)
  );
  for (let d = $from.depth; d > 0; d -= 1) {
    if ($from.node(d).type.name === SECTION_NODE)
      return $from.node(d).attrs.itemId;
  }
  return null;
}

// The text window: which open sections are on or near the screen, and the
// caret's, reported after a scroll settles or the caret moves to another section.
let viewportMargin = -1; // < 0: not asked for (no window), no reports
let viewportTimer: any = null;
let lastViewport = '';
let viewportInstalled = false;
const VIEWPORT_DELAY_MS = 180;

function reportViewport(force = false) {
  clearTimeout(viewportTimer);
  viewportTimer = null;
  const ed = currentEditor;
  if (!ed || ed.isDestroyed || viewportMargin < 0) return;
  const h = window.innerHeight || 800;
  const top = -viewportMargin * h;
  const bottom = h + viewportMargin * h;
  // A section's OWN lines (its title, its text or its parked line), not its whole
  // box: a chapter's box spans its scenes, the top section's the whole book.
  const near: string[] = [];
  const seenIds = new Set<string>();
  const parts = ed.view.dom.querySelectorAll(
    '.ik-section__title, .ik-section__body, .ik-section__parked'
  );
  for (let i = 0; i < parts.length; i += 1) {
    const r = parts[i].getBoundingClientRect();
    if (r.bottom < top || r.top > bottom) continue;
    const sec = parts[i].closest('[data-ik-section]');
    const id = sec && sec.getAttribute('data-item-id');
    if (!id || seenIds.has(id) || sec.getAttribute('data-open') !== 'true')
      continue;
    seenIds.add(id);
    near.push(id);
  }
  const cursor = ed.isFocused ? cursorSectionId(ed) : null;
  const key = `${cursor || ''}|${near.join(',')}`;
  if (!force && key === lastViewport) return;
  lastViewport = key;
  post({
    type: SectionEditorMessageType.Viewport,
    payload: { near, cursor },
  });
}

function scheduleViewport() {
  if (viewportMargin < 0 || viewportTimer) return;
  viewportTimer = setTimeout(() => reportViewport(), VIEWPORT_DELAY_MS);
}

let lastCursorSection: string | null = null;
function installViewport(ed: any) {
  if (viewportInstalled || !hasDom) return;
  viewportInstalled = true;
  window.addEventListener('scroll', scheduleViewport, { passive: true });
  window.addEventListener('resize', scheduleViewport);
  ed.on('selectionUpdate', () => {
    const id = cursorSectionId(ed);
    if (id !== lastCursorSection) {
      lastCursorSection = id;
      scheduleViewport();
    }
  });
  ed.on('focus', scheduleViewport);
}

/** The first section title on screen, and where it is (kept in place across a window step). */
function screenAnchor(ed: any): { el: any; top: number } | null {
  const titles = ed.view.dom.querySelectorAll('.ik-section__title');
  for (let i = 0; i < titles.length; i += 1) {
    const r = titles[i].getBoundingClientRect();
    if (r.bottom > 0) return { el: titles[i], top: r.top };
  }
  return null;
}

// Dragging a section by its handle: a drop line follows the finger; the app
// makes the move on release (the shared writingDrop rules).
let dropLine: any = null;
function showDropLine(rect: any, zone: string | null) {
  if (!dropLine) {
    dropLine = document.createElement('div');
    dropLine.className = 'ik-writing-drop';
    document.body.appendChild(dropLine);
  }
  if (!rect || !zone) {
    dropLine.style.display = 'none';
    return;
  }
  dropLine.setAttribute('data-zone', zone);
  dropLine.style.display = 'block';
  dropLine.style.left = `${rect.left - 4}px`;
  dropLine.style.width = `${rect.width + 8}px`;
  if (zone === 'into') {
    dropLine.style.top = `${rect.top - 2}px`;
    dropLine.style.height = `${rect.height + 4}px`;
  } else {
    dropLine.style.top = `${
      zone === 'before' ? rect.top - 2 : rect.bottom + 1
    }px`;
    dropLine.style.height = '0px';
  }
}

function dropTargetAt(x: number, y: number, dragged: string) {
  const el = document.elementFromPoint(x, y) as any;
  const sec = el && el.closest ? el.closest('[data-ik-section]') : null;
  if (!sec) return null;
  const targetId = sec.getAttribute('data-item-id');
  if (!targetId || targetId === dragged) return null;
  const line =
    sec.querySelector(':scope > .ik-section__content > .ik-section__title') ||
    sec;
  const rect = line.getBoundingClientRect();
  const isTop =
    !sec.parentElement || !sec.parentElement.closest('[data-ik-section]');
  const f = (y - rect.top) / Math.max(1, rect.height);
  const zone = isTop
    ? 'into'
    : f < 0.25
    ? 'before'
    : f > 0.75
    ? 'after'
    : 'into';
  return { targetId, zone: zone as 'before' | 'into' | 'after', rect };
}

function startDrag(itemId: string, event: any) {
  let target: ReturnType<typeof dropTargetAt> = null;
  document.body.classList.add('ik-dragging');
  const move = (e: any) => {
    e.preventDefault();
    target = dropTargetAt(e.clientX, e.clientY, itemId);
    showDropLine(target?.rect, target?.zone || null);
    const h = window.innerHeight;
    if (e.clientY < 60) window.scrollBy(0, -12);
    else if (e.clientY > h - 60) window.scrollBy(0, 12);
  };
  const end = (e: any) => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', end);
    document.removeEventListener('pointercancel', end);
    document.body.classList.remove('ik-dragging');
    showDropLine(null, null);
    if (e.type === 'pointerup' && target) {
      flushChanges();
      post({
        type: SectionEditorMessageType.Drop,
        payload: {
          dragged: itemId,
          target: target.targetId,
          zone: target.zone,
        },
      });
    }
  };
  document.addEventListener('pointermove', move, { passive: false } as any);
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  move(event);
}

function buildSectionExtensions(untitledLabel: string) {
  return createSectionExtensions(
    {
      Node,
      Extension,
      Plugin,
      PluginKey,
      Decoration,
      DecorationSet,
      dom: hasDom ? document : undefined,
    },
    {
      untitledLabel,
      onUnpark: (itemId) =>
        post({ type: SectionEditorMessageType.Unpark, payload: { itemId } }),
      onChange: (changed) => {
        changed.forEach((parts, itemId) => {
          const prev = pending.get(itemId) || { title: false, body: false };
          pending.set(itemId, {
            title: prev.title || parts.title,
            body: prev.body || parts.body,
          });
        });
        clearTimeout(flushTimer);
        flushTimer = setTimeout(flushChanges, CHANGE_DELAY_MS);
      },
      onToggle: (itemId, open) => {
        // What is waiting goes first: closing drops the text from the document.
        flushChanges();
        post({
          type: SectionEditorMessageType.Toggle,
          payload: { itemId, open },
        });
      },
      onMenu: (itemId) => {
        flushChanges();
        post({ type: SectionEditorMessageType.Menu, payload: { itemId } });
      },
      onDragStart: (itemId, event) => startDrag(itemId, event),
    }
  );
}

function handleSectionMessage(editor: any, message: SectionMessage): boolean {
  currentEditor = editor;
  const ed: any = editor;
  if (message.type === SectionActionType.Load) {
    flushChanges();
    const { outline, bodies } = message.payload;
    const json = buildSectionDocJSON(outline, (id) =>
      bodies[id] !== undefined
        ? blocksFromHtml(ed.schema, bodies[id] || '')
        : null
    );
    const tr = loadSectionDocument(ed.state.tr, json);
    ed.view.dispatch(tr);
    return true;
  }
  if (message.type === SectionActionType.Open) {
    const tr = ed.state.tr;
    if (
      openSection(
        tr,
        message.payload.itemId,
        blocksFromHtml(ed.schema, message.payload.html || '')
      )
    )
      ed.view.dispatch(tr);
    return true;
  }
  if (message.type === SectionActionType.Window) {
    const { load, park, margin } = message.payload;
    if (typeof margin === 'number') {
      viewportMargin = margin;
      installViewport(ed);
    }
    if (load.length || park.length) {
      // What is waiting goes first: parking takes the text out of the document.
      flushChanges();
      const anchor = screenAnchor(ed);
      const tr = ed.state.tr;
      let changed = false;
      for (const p of park)
        if (parkSection(tr, p.itemId, p.label || null)) changed = true;
      for (const l of load)
        if (openSection(tr, l.itemId, blocksFromHtml(ed.schema, l.html || '')))
          changed = true;
      if (changed) {
        ed.view.dispatch(tr);
        // Keep the first title on screen where it was (text came or went above it).
        if (anchor && anchor.el.isConnected) {
          const delta = anchor.el.getBoundingClientRect().top - anchor.top;
          if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
        }
      }
    }
    reportViewport(true);
    return true;
  }
  if (message.type === SectionActionType.Close) {
    flushChanges();
    const tr = ed.state.tr;
    if (closeSection(tr, message.payload.itemId)) ed.view.dispatch(tr);
    return true;
  }
  if (message.type === SectionActionType.Replace) {
    const { itemId, title, html, scene } = message.payload;
    // The scene mark is an attribute: set even under the cursor (the text is untouched).
    if (typeof scene === 'boolean') {
      const str = ed.state.tr;
      if (setSectionTitleScene(str, itemId, scene)) ed.view.dispatch(str);
    }
    if (typeof title !== 'string' && typeof html !== 'string') return true;
    // Never under the cursor, nor over an edit not yet sent.
    if (itemId === cursorSectionId(ed) || pending.has(itemId)) return true;
    const tr = ed.state.tr;
    if (typeof title === 'string') replaceSectionTitle(tr, itemId, title);
    if (typeof html === 'string') {
      const hit = findSection(tr.doc, itemId);
      if (hit && readSection(hit.node).body)
        replaceSectionBody(tr, itemId, blocksFromHtml(ed.schema, html));
    }
    if (tr.steps.length) ed.view.dispatch(tr);
    return true;
  }
  if (message.type === SectionActionType.State) {
    const root = ed.view.dom as any;
    const sections = Array.prototype.map.call(
      root.querySelectorAll('[data-ik-section]'),
      (s: any) => {
        const content = s.querySelector(':scope > .ik-section__content');
        const heading =
          content && content.querySelector(':scope > .ik-section__title');
        const parent =
          s.parentElement && s.parentElement.closest('[data-ik-section]');
        return {
          id: s.getAttribute('data-item-id'),
          parentId: parent ? parent.getAttribute('data-item-id') : null,
          open: s.getAttribute('data-open') === 'true',
          heading: heading ? heading.tagName.toLowerCase() : null,
          title: heading ? heading.textContent : '',
          text:
            (
              (content &&
                content.querySelector(':scope > .ik-section__body')) ||
              {}
            ).textContent || '',
        };
      }
    );
    post({
      type: SectionEditorMessageType.State,
      payload: {
        requestId: message.payload.requestId,
        data: {
          editors: document.querySelectorAll('.ProseMirror').length,
          sections,
          h1: (root.querySelector('h1') || {}).textContent || '',
          text: root.textContent,
        },
      },
    });
    return true;
  }
  return false;
}

export const SectionBridge = new BridgeExtension<
  {},
  SectionEditorInstance,
  SectionMessage
>({
  forceName: 'ikSectionBridge',
  onBridgeMessage: (editor, message) => {
    try {
      return handleSectionMessage(editor, message);
    } catch (e: any) {
      // Kept on the page for the app's harness probe (window.ikSectionError).
      if (hasDom)
        window.ikSectionError = `${message && (message as any).type}: ${
          e && e.message
        }`;
      return false;
    }
  },
  onEditorMessage: (message, editorBridge) => {
    const types = Object.values(SectionEditorMessageType) as string[];
    if (!types.includes(message.type as string)) return false;
    (editorBridge as any).sectionListener?.(message as SectionEditorMessage);
    return true;
  },
  extendEditorInstance: (sendBridgeMessage) => ({
    loadSections: (outline, bodies) =>
      sendBridgeMessage({
        type: SectionActionType.Load,
        payload: { outline, bodies },
      }),
    openSection: (itemId, html) =>
      sendBridgeMessage({
        type: SectionActionType.Open,
        payload: { itemId, html },
      }),
    closeSection: (itemId) =>
      sendBridgeMessage({ type: SectionActionType.Close, payload: { itemId } }),
    replaceSection: (itemId, change) =>
      sendBridgeMessage({
        type: SectionActionType.Replace,
        payload: { itemId, ...change },
      }),
    windowSections: (load, park, margin) =>
      sendBridgeMessage({
        type: SectionActionType.Window,
        payload: { load, park, margin },
      }),
    requestSectionState: (requestId) =>
      sendBridgeMessage({
        type: SectionActionType.State,
        payload: { requestId },
      }),
  }),
  extendEditorState: () => ({}),
});

// Runs on the page: the nodes are built there, with the app's label.
(SectionBridge as any).configureTiptapExtensionsOnRunTime = (config: any) => {
  const [, ...rest] = buildSectionExtensions(
    (config && config.untitledLabel) || 'Untitled'
  );
  return rest; // the document node is the core bridge's, extended to hold sections
};
