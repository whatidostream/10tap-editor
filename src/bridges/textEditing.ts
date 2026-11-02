import type { Editor } from '@tiptap/core';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import BridgeExtension from './base';

/**
 * Selecting by text unit, and inserting plain text (paste), for toolbars that
 * run outside the web view.
 *
 * `selectRange(unit)` works around the current selection (a caret, or the ends
 * of a range, which is widened at both ends):
 * - `word`: the run of letters, digits and `_` (any script) touching the caret.
 *   If none touches it, the run of non-space characters touching it. Between
 *   two spaces, nothing changes.
 * - `line`: one line of the text block holding the caret: the text between hard
 *   breaks (Shift+Enter, or a single newline in markdown), or the whole block
 *   when it has none. Not the visual (wrapped) line, which the page lays out.
 * - `paragraph`: the whole text block holding the caret (a paragraph, heading,
 *   list item's paragraph, code block). A range spanning blocks widens to the
 *   start of the first and the end of the last.
 * - `all`: the whole document.
 *
 * `insertText(text)` inserts plain text at the selection, replacing it, the way
 * a paste of plain text does: newlines become new paragraphs (inside a code
 * block they stay newlines), and the editor's own paste rules apply.
 */
export type TextSelectionUnit = 'word' | 'line' | 'paragraph' | 'all';

type TextEditingEditorState = {};

type TextEditingEditorInstance = {
  selectRange: (unit: TextSelectionUnit) => void;
  insertText: (text: string) => void;
};

declare module '../types/EditorBridge' {
  interface BridgeState extends TextEditingEditorState {}
  interface EditorBridge extends TextEditingEditorInstance {}
}

export enum TextEditingEditorActionType {
  SelectRange = 'select-text-range',
  InsertText = 'insert-plain-text',
}

type TextEditingMessage =
  | {
      type: TextEditingEditorActionType.SelectRange;
      payload: { unit: TextSelectionUnit };
    }
  | {
      type: TextEditingEditorActionType.InsertText;
      payload: { text: string };
    };

// Every inline leaf counts as one character, so an offset into this string is
// an offset into the block's content (text is one position per character).
const blockText = (block: PMNode) =>
  block.textBetween(0, block.content.size, undefined, (leaf: PMNode) =>
    leaf.type.name === 'hardBreak' ? '\n' : '￼'
  );

const WORD = /[\p{L}\p{N}\p{M}_]/u;
const NON_SPACE = /[^\s￼]/u;

// [start, end) of the run of `re` characters touching offset `at`.
const runAround = (text: string, at: number, re: RegExp): [number, number] => {
  let start = at;
  let end = at;
  while (start > 0 && re.test(text[start - 1]!)) start--;
  while (end < text.length && re.test(text[end]!)) end++;
  return [start, end];
};

// Range of the unit around one end of the selection, as document positions.
const unitAround = (
  $pos: ResolvedPos,
  unit: 'word' | 'line'
): [number, number] | null => {
  const block = $pos.parent;
  if (!block.isTextblock) return null;
  const text = blockText(block);
  const at = $pos.parentOffset;
  const base = $pos.start();
  if (unit === 'line') {
    const start = text.lastIndexOf('\n', at - 1) + 1;
    const nl = text.indexOf('\n', at);
    return [base + start, base + (nl === -1 ? text.length : nl)];
  }
  let [start, end] = runAround(text, at, WORD);
  if (start === end) [start, end] = runAround(text, at, NON_SPACE);
  if (start === end) return null;
  return [base + start, base + end];
};

export const selectTextRange = (editor: Editor, unit: TextSelectionUnit) => {
  if (unit === 'all') {
    editor.chain().focus().selectAll().run();
    return;
  }
  const { $from, $to } = editor.state.selection;
  let range: [number, number] | null = null;
  if (unit === 'paragraph') {
    if ($from.parent.isTextblock && $to.parent.isTextblock) {
      range = [$from.start(), $to.end()];
    }
  } else {
    const a = unitAround($from, unit);
    const b = $to.pos === $from.pos ? a : unitAround($to, unit);
    if (a || b) {
      range = [a ? a[0] : $from.pos, b ? b[1] : $to.pos];
    }
  }
  if (!range) {
    editor.commands.focus();
    return;
  }
  editor
    .chain()
    .focus()
    .setTextSelection({ from: range[0], to: range[1] })
    .run();
};

export const insertPlainText = (editor: Editor, text: string) => {
  const { view, state } = editor;
  editor.commands.focus();
  if (state.selection.$from.parent.type.spec.code || !text.includes('\n')) {
    view.dispatch(state.tr.insertText(text).scrollIntoView());
    return;
  }
  if (typeof view.pasteText === 'function' && view.pasteText(text)) return;
  const paragraphs = text
    .split(/\r?\n/)
    .map((line) =>
      line
        ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
        : { type: 'paragraph' }
    );
  editor.chain().focus().insertContent(paragraphs).run();
};

export const TextEditingBridge = new BridgeExtension<
  TextEditingEditorState,
  TextEditingEditorInstance,
  TextEditingMessage
>({
  forceName: 'textEditing',
  onBridgeMessage: (editor, message) => {
    if (message.type === TextEditingEditorActionType.SelectRange) {
      selectTextRange(editor, message.payload.unit);
      return true;
    }
    if (message.type === TextEditingEditorActionType.InsertText) {
      insertPlainText(editor, String(message.payload.text ?? ''));
      return true;
    }
    return false;
  },
  extendEditorInstance: (sendBridgeMessage) => {
    return {
      selectRange: (unit: TextSelectionUnit) =>
        sendBridgeMessage({
          type: TextEditingEditorActionType.SelectRange,
          payload: { unit },
        }),
      insertText: (text: string) =>
        sendBridgeMessage({
          type: TextEditingEditorActionType.InsertText,
          payload: { text },
        }),
    };
  },
});
