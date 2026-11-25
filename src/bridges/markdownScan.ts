// @ts-nocheck: COPY of InfiniKan apps/shared/src/editor/markdownScan.ts (the fork builds alone; InfiniKan's tsconfig, not this one's noUncheckedIndexedAccess, checks it); keep in step:
// the InfiniKan unit test writing-richtext-roundtrip compares the two.
/* eslint-disable */
/**
 * Low-level markdown scanning shared by markdownFormat (the toolbar's text edits)
 * and markdownLint (the warning line): fenced code blocks, code spans and
 * CommonMark's emphasis pairing (delimiter runs, flanking, the rule of 3).
 *
 * Pure, no package imports. It reads markdown the way `marked` (gfm) does for
 * ordinary text; the unit tests check it against marked itself.
 */

/** A fenced code block, by 0-based line index. `closeLine` is -1 when it never closes. */
export interface FencedBlock {
  openLine: number;
  closeLine: number;
  char: string;
  length: number;
}

/** A code span on one string: `[start, end)` covers the backtick runs too. */
export interface CodeSpan {
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
}

export type EmphasisKind = 'bold' | 'italic' | 'strike';

/** A matched emphasis pair: the opening marker is [openStart, openEnd), the closing [closeStart, closeEnd). */
export interface EmphasisSpan {
  kind: EmphasisKind;
  char: string;
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
}

/** A delimiter run some of whose markers stayed unmatched (they show as literal text). */
export interface LeftoverRun {
  char: string;
  start: number;
  /** Length of the whole run as written. */
  length: number;
  /** How many of its markers stayed unmatched. */
  left: number;
}

const QUOTE_PREFIX_RE = /^(?:[ \t]{0,3}>[ \t]?)*/;
const FENCE_OPEN_RE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;

/** Offsets where each line starts. */
export function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}

/** The `>` quote prefix of a line (possibly empty). */
export function quotePrefix(line: string): string {
  return QUOTE_PREFIX_RE.exec(line)?.[0] ?? '';
}

/** Every fenced code block in the text (``` or ~~~, inside quotes too). */
export function fencedBlocks(lines: string[]): FencedBlock[] {
  const out: FencedBlock[] = [];
  let open: FencedBlock | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '');
    const line = raw.slice(quotePrefix(raw).length);
    const m = FENCE_OPEN_RE.exec(line);
    if (open) {
      if (m && m[2][0] === open.char && m[2].length >= open.length && m[3].trim() === '') {
        open.closeLine = i;
        out.push(open);
        open = null;
      }
    } else if (m && !(m[2][0] === '`' && m[3].includes('`'))) {
      open = { openLine: i, closeLine: -1, char: m[2][0], length: m[2].length };
    }
  }
  if (open) out.push(open);
  return out;
}

/** For each line: is it part of a fenced block (fence lines included)? */
export function fencedLineMask(lines: string[], blocks: FencedBlock[] = fencedBlocks(lines)): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  for (const b of blocks) {
    const last = b.closeLine === -1 ? lines.length - 1 : b.closeLine;
    for (let i = b.openLine; i <= last; i++) mask[i] = true;
  }
  return mask;
}

/**
 * Code spans: a run of n backticks opens, the next run of exactly n closes.
 * Escaped backticks (`\``) outside a span neither open nor close.
 * Returns the spans and the backtick runs left unmatched.
 */
export function codeSpans(s: string): { spans: CodeSpan[]; unmatched: Array<{ start: number; length: number }> } {
  const spans: CodeSpan[] = [];
  const unmatched: Array<{ start: number; length: number }> = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] !== '`') continue;
    let j = i;
    while (j < s.length && s[j] === '`') j++;
    const length = j - i;
    // Inside a span backslashes are literal: the closer is the next run of exactly n.
    const close = rawRunAfter(s, j, length);
    if (close === -1) {
      unmatched.push({ start: i, length });
      i = j - 1;
      continue;
    }
    spans.push({ start: i, end: close + length, innerStart: j, innerEnd: close });
    i = close + length - 1;
  }
  return { spans, unmatched };
}

function rawRunAfter(s: string, from: number, length: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] !== '`') continue;
    let j = i;
    while (j < s.length && s[j] === '`') j++;
    if (j - i === length) return i;
    i = j - 1;
  }
  return -1;
}

const WS_RE = /\s/;
const PUNCT_RE = /[!-/:-@[-`{-~\p{P}\p{S}]/u;

function isWs(ch: string | undefined): boolean {
  return ch === undefined || WS_RE.test(ch);
}
function isPunct(ch: string | undefined): boolean {
  return ch !== undefined && PUNCT_RE.test(ch);
}

interface Delim {
  char: string;
  start: number;
  length: number;
  count: number;
  /** Markers already used from the left (as a closer) — a closer uses its leftmost markers. */
  usedLeft: number;
  canOpen: boolean;
  canClose: boolean;
  /** Could it open or close as written (before a pair around it disabled it)? */
  flanking: boolean;
}

/**
 * CommonMark emphasis pairing over `s` (one inline context: a paragraph, a
 * heading, a table cell). Characters where `skip[i]` is true (code spans, link
 * destinations, URLs, escapes the caller masked) are never delimiters.
 * `*` / `_` give bold (pairs of 2) and italic (1); `~` / `~~` give strike
 * (GFM: opener and closer the same length, 1 or 2).
 */
export function pairEmphasis(s: string, skip?: (i: number) => boolean): { spans: EmphasisSpan[]; leftovers: LeftoverRun[] } {
  const delims: Delim[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (skip && skip(i)) continue;
    if (ch === '\\') { i++; continue; }
    if (ch !== '*' && ch !== '_' && ch !== '~') continue;
    let j = i;
    while (j < s.length && s[j] === ch && !(skip && skip(j))) j++;
    const before = s[i - 1];
    const after = s[j];
    const left = !isWs(after) && (!isPunct(after) || isWs(before) || isPunct(before));
    const right = !isWs(before) && (!isPunct(before) || isWs(after) || isPunct(after));
    let canOpen = left;
    let canClose = right;
    if (ch === '_') {
      canOpen = left && (!right || isPunct(before));
      canClose = right && (!left || isPunct(after));
    }
    if (ch === '~' && j - i > 2) { canOpen = false; canClose = false; }
    delims.push({ char: ch, start: i, length: j - i, count: j - i, usedLeft: 0, canOpen, canClose, flanking: canOpen || canClose });
    i = j - 1;
  }

  const spans: EmphasisSpan[] = [];
  for (let c = 0; c < delims.length; c++) {
    const closer = delims[c];
    while (closer.canClose && closer.count > 0) {
      let found = -1;
      for (let o = c - 1; o >= 0; o--) {
        const op = delims[o];
        if (op.char !== closer.char || !op.canOpen || op.count === 0) continue;
        if (closer.char === '~') {
          if (op.length !== closer.length) continue;
        } else if ((op.canClose || closer.canOpen)
          && (op.length + closer.length) % 3 === 0
          && !(op.length % 3 === 0 && closer.length % 3 === 0)) {
          continue;
        }
        found = o;
        break;
      }
      if (found === -1) break;
      const op = delims[found];
      const use = closer.char === '~' ? closer.length : (op.count >= 2 && closer.count >= 2 ? 2 : 1);
      const openEnd = op.start + op.count;
      const closeStart = closer.start + closer.usedLeft;
      spans.push({
        kind: closer.char === '~' ? 'strike' : use === 2 ? 'bold' : 'italic',
        char: closer.char,
        openStart: openEnd - use,
        openEnd,
        closeStart,
        closeEnd: closeStart + use,
      });
      op.count -= use;
      closer.count -= use;
      closer.usedLeft += use;
      // Delimiters between the pair can no longer match anything.
      for (let k = found + 1; k < c; k++) delims[k].canOpen = delims[k].canClose = false;
    }
  }

  const leftovers: LeftoverRun[] = [];
  for (const d of delims) {
    if (d.count > 0 && (d.flanking || d.count < d.length)) {
      leftovers.push({ char: d.char, start: d.start, length: d.length, left: d.count });
    }
  }
  return { spans, leftovers };
}

const AUTOLINK_RE = /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>]+)>/g;
const HTML_TAG_RE = /<\/?[A-Za-z][\w-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<!--[\s\S]*?-->/g;
const BARE_URL_RE = /(?:\b(?:https?|ftp):\/\/|\bwww\.)[^\s<]*/g;

/**
 * Which characters of one inline context are not ordinary text for emphasis:
 * code spans (backticks included), link destinations `](…)`, autolinks `<…>`,
 * inline HTML tags and bare URLs (GFM autolinks, without their trailing
 * punctuation). Markers there never pair.
 *
 * `linksFirst` reads a link destination as winning over a code span that
 * starts inside it (marked reads left to right, so `[t](a`b`)` is a link);
 * by default code spans win. The lint warns only where both readings agree.
 */
export function inlineSkipMask(s: string, spans?: CodeSpan[], linksFirst = false): boolean[] {
  const mask = new Array<boolean>(s.length).fill(false);
  const fill = (a: number, b: number) => { for (let i = a; i < b; i++) mask[i] = true; };
  const destinations = (skipCode: boolean[] | null) => {
    for (let i = s.indexOf(']('); i !== -1; i = s.indexOf('](', i + 1)) {
      if (skipCode && skipCode[i]) continue;
      const end = linkDestinationReach(s, i + 2);
      if (end !== -1) fill(i + 2, end);
    }
  };
  if (linksFirst) {
    destinations(null);
    const plain = s.split('').map((ch, i) => (mask[i] ? 'a' : ch)).join('');
    for (const c of codeSpans(plain).spans) fill(c.start, c.end);
  } else {
    for (const c of spans ?? codeSpans(s).spans) fill(c.start, c.end);
    destinations(mask.slice());
  }
  const free = (i: number) => !mask[i];
  for (const re of [AUTOLINK_RE, HTML_TAG_RE]) {
    re.lastIndex = 0;
    for (let m = re.exec(s); m; m = re.exec(s)) if (free(m.index)) fill(m.index, m.index + m[0].length);
  }
  BARE_URL_RE.lastIndex = 0;
  for (let m = BARE_URL_RE.exec(s); m; m = BARE_URL_RE.exec(s)) {
    if (!free(m.index)) continue;
    let end = m.index + m[0].length;
    while (end > m.index && /[?!.,:*_~'")]/.test(s[end - 1])) end--;
    fill(m.index, end);
  }
  return mask;
}

/**
 * How far a link destination starting at `from` (just after `](`) reaches, read
 * as marked does: the run of non-space characters up to its last `)`, cut at
 * the first `)` that closes more than it opened. Without a `)` in that run,
 * the first `)` later on the line (after a title). -1 when it is no link.
 */
export function linkDestinationReach(s: string, from: number): number {
  let i = from;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
  let runEnd = i;
  while (runEnd < s.length && !/\s/.test(s[runEnd])) runEnd++;
  const last = s.lastIndexOf(')', runEnd - 1);
  if (last >= i) {
    if (s.lastIndexOf(')', last - 1) < i) return last + 1;
    let level = 0;
    for (let k = i; k < last; k++) {
      if (s[k] === '\\') { k++; continue; }
      if (s[k] === '(') level++;
      else if (s[k] === ')' && --level < 0) return k + 1;
    }
    return level > 0 ? -1 : last + 1;
  }
  const nl = s.indexOf('\n', runEnd);
  const close = s.indexOf(')', runEnd);
  if (close !== -1 && (nl === -1 || close < nl)) return close + 1;
  return -1;
}
