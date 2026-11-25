// The page's DOM (the page half runs in the editor web view; the lib has no dom types).
declare const document: any;

import { Node, Mark } from '@tiptap/core';
import BridgeExtension from './base';
import {
  createWritingExtensions,
  WRITING_NODE_CSS,
  type WritingLabels,
} from './writingNodes';

/**
 * InfiniKan fork: writing markdown in the editor (maths, footnotes, CriticMarkup,
 * sub / superscript, escaped characters). writingNodes.ts is a copy of
 * InfiniKan's apps/shared/src/editor/writingNodes.ts (its unit test
 * writing-richtext-roundtrip checks the copy is in step). Each atom holds its
 * markdown source as typed, so a note survives being opened and saved here; a
 * tap opens the source in a small box in place. Maths shows its TeX (KaTeX is
 * not loaded in this page). Highlight is left to HighlightBridge (TipTap's
 * Highlight reads the same <mark>).
 *
 * Translated words: WritingBridge.configureExtension({ labels: { edit, done } }).
 */
const build = (labels?: Partial<WritingLabels>, dom?: any) =>
  createWritingExtensions({ Node, Mark, dom }, { highlight: false, labels });

const [first, ...rest] = build();

export const WritingBridge = new BridgeExtension<{}, {}, any>({
  tiptapExtension: first,
  tiptapExtensionDeps: rest,
  extendCSS: WRITING_NODE_CSS,
});

// On the page: the nodes with their in-place views and the app's words.
(WritingBridge as any).configureTiptapExtensionsOnRunTime = (config: any) =>
  build(
    config && config.labels,
    typeof document !== 'undefined' ? document : undefined
  );
