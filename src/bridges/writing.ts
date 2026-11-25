import { Node, Mark } from '@tiptap/core';
import BridgeExtension from './base';
import { createWritingExtensions } from './writingNodes';

/**
 * InfiniKan fork: writing markdown in the editor (maths, footnotes, CriticMarkup,
 * sub / superscript, escaped characters). writingNodes.ts is a copy of
 * InfiniKan's apps/shared/src/editor/writingNodes.ts (its unit test
 * writing-richtext-roundtrip checks the copy is in step). Each atom holds its
 * markdown source as typed, so a note survives being opened and saved here.
 * Highlight is left to HighlightBridge (TipTap's Highlight reads the same <mark>).
 */
const [first, ...rest] = createWritingExtensions(
  { Node, Mark },
  { highlight: false }
);

export const WritingBridge = new BridgeExtension<{}, {}, any>({
  tiptapExtension: first,
  tiptapExtensionDeps: rest,
  extendCSS: `
  .ik-wr {
    font-family: ui-monospace, Menlo, monospace;
    font-size: 0.9em;
    border-radius: 4px;
    padding: 0 3px;
    background: rgba(127, 127, 127, 0.15);
    white-space: pre-wrap;
  }
  div.ik-wr {
    display: block;
    padding: 4px 6px;
    margin: 0.5em 0;
  }
  .ik-wr--critic { background: rgba(46, 160, 67, 0.15); }
  .ik-wr--footnoteRef { font-size: 0.75em; vertical-align: super; }
  .ik-wr.ProseMirror-selectednode { outline: 2px solid rgba(80, 140, 255, 0.7); }
  `,
});
