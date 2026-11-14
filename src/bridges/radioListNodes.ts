// COPY of InfiniKan apps/shared/src/editor/richTextRadio.ts (the fork builds alone); keep in step:
// the InfiniKan unit test content-radio-choices compares the two (formatted as InfiniKan does).
/* eslint-disable */
/**
 * Radio buttons in the RICH-TEXT editors (TipTap on web and desktop): a RadioList of
 * RadioItems, the single-choice twin of TipTap's TaskList / TaskItem. Picking an
 * item clears the others in its list. Markdown `- ( ) option` / `- (x) option`
 * converts to and from them (content/richTextTasks.ts, content/taskToggle.ts).
 *
 * Built by extending the app's own TaskList / TaskItem (passed in: shared code
 * imports no packages), so lists, Enter / Tab / Shift-Tab and nesting behave as a
 * checklist's do.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const RADIO_LIST_NODE = 'radioList';
export const RADIO_ITEM_NODE = 'radioItem';

/**
 * Pick the radio item at `pos` (the position before it) in a transaction: it is
 * checked, every other radio item in the same list is cleared.
 */
export function pickRadioItem(tr: any, pos: number): boolean {
  if (typeof pos !== 'number') return false;
  const node = tr.doc.nodeAt(pos);
  if (!node || node.type.name !== RADIO_ITEM_NODE) return false;
  const $pos = tr.doc.resolve(pos);
  const list = $pos.parent;
  const base = $pos.start();
  list.forEach((child: any, offset: number) => {
    if (child.type.name !== RADIO_ITEM_NODE) return;
    const at = base + offset;
    const want = at === pos;
    if (!!child.attrs.checked !== want) tr.setNodeMarkup(at, undefined, { ...child.attrs, checked: want });
  });
  return true;
}

/** The RadioList / RadioItem extensions, made from the app's TaskList / TaskItem. */
export function createRadioListExtensions({ TaskList, TaskItem }: { TaskList: any; TaskItem: any }): { RadioList: any; RadioItem: any } {
  const RadioItem = TaskItem.extend({
    name: RADIO_ITEM_NODE,

    addOptions(this: any) {
      return { ...this.parent?.(), taskListTypeName: RADIO_LIST_NODE };
    },

    renderHTML({ node, HTMLAttributes }: any) {
      return [
        'li',
        { ...HTMLAttributes, 'data-type': RADIO_ITEM_NODE },
        ['label', ['input', { type: 'radio', class: 'ik-radio', checked: node.attrs.checked ? 'checked' : null }], ['span']],
        ['div', 0],
      ];
    },

    // Not TipTap's markdown support (the apps convert with marked / turndown).
    parseMarkdown: undefined,
    renderMarkdown: undefined,
    markdownTokenizer: undefined,

    // `[ ] ` typed at a line start makes a checklist; radios come from the button
    // or `( ) ` written in a bullet (kept on save).
    addInputRules() {
      return [];
    },

    addNodeView(this: any) {
      const type = this.type;
      return ({ node, getPos, editor }: any) => {
        // Node views are made while the editor mounts, before editor.view exists.
        const doc = (globalThis as any).document;
        const listItem = doc.createElement('li');
        const label = doc.createElement('label');
        const input = doc.createElement('input');
        const styler = doc.createElement('span');
        const content = doc.createElement('div');
        let current = node;

        const sync = (n: any) => {
          const checked = !!n.attrs.checked;
          listItem.dataset.checked = String(checked);
          input.checked = checked;
          input.setAttribute('aria-label', n.textContent || '');
        };

        listItem.dataset.type = RADIO_ITEM_NODE;
        label.contentEditable = 'false';
        input.type = 'radio';
        input.className = 'ik-radio';
        input.addEventListener('mousedown', (event: any) => event.preventDefault());
        input.addEventListener('change', () => {
          if (!editor.isEditable || typeof getPos !== 'function') {
            input.checked = !!current.attrs.checked;
            return;
          }
          editor
            .chain()
            .focus(undefined, { scrollIntoView: false })
            .command(({ tr }: any) => pickRadioItem(tr, getPos()))
            .run();
        });
        label.append(input, styler);
        listItem.append(label, content);
        sync(node);

        return {
          dom: listItem,
          contentDOM: content,
          update: (updated: any) => {
            if (updated.type !== type) return false;
            current = updated;
            sync(updated);
            return true;
          },
        };
      };
    },
  });

  const RadioList = TaskList.extend({
    name: RADIO_LIST_NODE,

    addOptions(this: any) {
      return { ...this.parent?.(), itemTypeName: RADIO_ITEM_NODE };
    },

    parseMarkdown: undefined,
    renderMarkdown: undefined,
    markdownTokenizer: undefined,

    addCommands(this: any) {
      return {
        toggleRadioList: () => ({ commands }: any) => commands.toggleList(this.name, this.options.itemTypeName),
      };
    },

    addKeyboardShortcuts() {
      return {};
    },
  });

  return { RadioList, RadioItem };
}
