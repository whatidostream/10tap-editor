// The page's DOM (this file's page half runs in the editor web view; the lib has no dom types).
declare const document: any;
declare const window: any;

import { Node, Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DOMParser as PMDOMParser, DOMSerializer } from '@tiptap/pm/model';
import BridgeExtension from './base';
import {
  createSectionExtensions,
  buildSectionDocJSON,
  loadSectionDocument,
  openSection,
  closeSection,
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
 * App → editor: loadSections, openSection, closeSection, replaceSection,
 * requestSectionState. Editor → app (editor.sectionListener): section-changed
 * [{ itemId, title, html }], section-toggle, section-menu, section-drop,
 * section-state.
 */

export enum SectionActionType {
  Load = 'section-load',
  Open = 'section-open',
  Close = 'section-close',
  Replace = 'section-replace',
  State = 'section-state-request',
}

export enum SectionEditorMessageType {
  Changed = 'section-changed',
  Toggle = 'section-toggle',
  Menu = 'section-menu',
  Drop = 'section-drop',
  State = 'section-state',
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
    };

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
  pending.forEach((parts, itemId) => {
    const hit = findSection(ed.state.doc, itemId);
    if (!hit) return;
    const { title, body } = readSection(hit.node);
    out.push({
      itemId,
      title,
      html: parts.body ? htmlFromBody(ed.schema, body) : null,
      titleChanged: parts.title,
      bodyChanged: parts.body,
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
    { Node, Extension, Plugin, PluginKey, dom: hasDom ? document : undefined },
    {
      untitledLabel,
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
