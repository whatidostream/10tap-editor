// The page's DOM and window (the page half runs in the editor web view; the lib has no dom types).
declare const document: any;
declare const window: any;

import { Node, Mark } from '@tiptap/core';
import BridgeExtension from './base';
import {
  createWritingExtensions,
  WRITING_NODE_CSS,
  type WritingLabels,
} from './writingNodes';
import { acceptAllCritic, rejectAllCritic } from './criticMarkup';

/**
 * InfiniKan fork: writing markdown in the editor (maths, footnotes, definition
 * lists, CriticMarkup, sub / superscript, escaped characters). writingNodes.ts,
 * criticMarkup.ts and markdownScan.ts are copies of InfiniKan's
 * apps/shared/src/editor files (its unit test writing-richtext-roundtrip checks
 * the copies are in step). Each atom holds its markdown source as typed, so a
 * note survives being opened and saved here; a tap opens the source in a small
 * box in place, with Accept / Reject for a CriticMarkup change. The editor
 * command insertWritingAtom('math' | 'mathBlock' | 'footnote') puts a new atom in
 * and opens its box. Highlight is left to HighlightBridge (TipTap's Highlight
 * reads the same <mark>).
 *
 * Maths is typeset once the app has injected KaTeX (with mhchem) into the page:
 * the app runs the script with injectJavaScript after each page load, then calls
 * window.__ikKatexReady(); until then (or without it) a formula shows its TeX.
 *
 * Translated words: WritingBridge.configureExtension({ labels: { edit, done, accept, reject } }).
 */

// Views waiting for KaTeX, answered when the app's script has run.
const katexWaiters: Array<(katex: any) => void> = [];

const loadKatex = (): Promise<any> =>
  new Promise((resolve) => {
    if (typeof window === 'undefined') return;
    if (window.katex) {
      resolve(window.katex);
      return;
    }
    katexWaiters.push(resolve);
  });

const build = (labels?: Partial<WritingLabels>, dom?: any) =>
  createWritingExtensions(
    {
      Node,
      Mark,
      dom,
      loadKatex: dom ? loadKatex : undefined,
      resolveCritic: (source: string, accept: boolean) =>
        accept ? acceptAllCritic(source) : rejectAllCritic(source),
    },
    { highlight: false, labels }
  );

const [first, ...rest] = build();

export const WritingBridge = new BridgeExtension<{}, {}, any>({
  tiptapExtension: first,
  tiptapExtensionDeps: rest,
  extendCSS: WRITING_NODE_CSS,
});

// On the page: the nodes with their in-place views and the app's words.
(WritingBridge as any).configureTiptapExtensionsOnRunTime = (config: any) => {
  if (typeof window !== 'undefined') {
    window.__ikKatexReady = () => {
      const katex = window.katex;
      if (katex) katexWaiters.splice(0).forEach((resolve) => resolve(katex));
    };
  }
  return build(
    config && config.labels,
    typeof document !== 'undefined' ? document : undefined
  );
};
