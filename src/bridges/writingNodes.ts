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
}

export interface WritingExtensionOptions {
  /**
   * Add the `highlight` mark (default true). The phones' TenTap kit already has
   * TipTap's Highlight, which reads and writes the same <mark>.
   */
  highlight?: boolean;
}

/**
 * The extensions: five atoms and four marks (three without highlight). Add them
 * after StarterKit.
 */
export function createWritingExtensions(deps: WritingExtensionDeps, options: WritingExtensionOptions = {}): any[] {
  const { Node, Mark } = deps;

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
