// @ts-nocheck: COPY of InfiniKan apps/shared/src/editor/criticMarkup.ts (the fork builds alone; InfiniKan's tsconfig, not this one's noUncheckedIndexedAccess, checks it); keep in step:
// the InfiniKan unit test writing-richtext-roundtrip compares the two.
/* eslint-disable */
/**
 * CriticMarkup accept / reject on markdown text (plans/writing-view-and-settings-templates.md §B1).
 *
 *   {++added++}           accept → added      reject → (gone)
 *   {--removed--}         accept → (gone)     reject → removed
 *   {~~old~>new~~}        accept → new        reject → old
 *   {==marked==}          either → marked     (the highlight is unwrapped)
 *   {>>comment<<}         either → (gone)
 *
 * A highlight with its comment straight after it (`{==x==}{>>why<<}`) is one
 * change. Marks inside fenced code and code spans are text, not changes.
 * Pure: every function takes the text and returns new text (and a caret).
 */

import { fencedBlocks, fencedLineMask, lineStarts, codeSpans } from './markdownScan';

export type CriticKind = 'insertion' | 'deletion' | 'substitution' | 'highlight' | 'comment';

export interface CriticChange {
  kind: CriticKind;
  /** [start, end) of the whole mark in the text. */
  start: number;
  end: number;
  /** What the text becomes when the change is accepted / rejected. */
  accepted: string;
  rejected: string;
  /** The comment, for a comment or a commented highlight. */
  comment?: string;
}

export interface CriticEdit {
  text: string;
  selStart: number;
  selEnd: number;
}

const CRITIC_RE = /\{\+\+([\s\S]*?)\+\+\}|\{--([\s\S]*?)--\}|\{~~([\s\S]*?)~>([\s\S]*?)~~\}|\{==([\s\S]*?)==\}(?:\{>>([\s\S]*?)<<\})?|\{>>([\s\S]*?)<<\}/g;

/** Offsets that are code (fenced lines and code spans): marks there are not changes. */
function codeMask(text: string): (i: number) => boolean {
  const lines = text.split('\n');
  const starts = lineStarts(text);
  const fenced = fencedLineMask(lines, fencedBlocks(lines));
  const ranges: Array<[number, number]> = [];
  fenced.forEach((isFenced, i) => {
    if (isFenced) ranges.push([starts[i], starts[i] + lines[i].length + 1]);
  });
  // Code spans in the text outside fences (fenced lines blanked so offsets stay put).
  const outside = lines.map((l, i) => (fenced[i] ? ' '.repeat(l.length) : l)).join('\n');
  codeSpans(outside).spans.forEach((s) => ranges.push([s.start, s.end]));
  return (i: number) => ranges.some(([a, b]) => i >= a && i < b);
}

/** Every CriticMarkup change in the text, in order. */
export function findCriticChanges(text: string): CriticChange[] {
  const src = typeof text === 'string' ? text : '';
  if (!src.includes('{')) return [];
  const inCode = codeMask(src);
  const out: CriticChange[] = [];
  CRITIC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CRITIC_RE.exec(src))) {
    const start = m.index;
    const end = start + m[0].length;
    if (inCode(start)) {
      CRITIC_RE.lastIndex = start + 1;
      continue;
    }
    if (m[1] !== undefined) out.push({ kind: 'insertion', start, end, accepted: m[1], rejected: '' });
    else if (m[2] !== undefined) out.push({ kind: 'deletion', start, end, accepted: '', rejected: m[2] });
    else if (m[3] !== undefined) out.push({ kind: 'substitution', start, end, accepted: m[4], rejected: m[3] });
    else if (m[5] !== undefined) {
      const change: CriticChange = { kind: 'highlight', start, end, accepted: m[5], rejected: m[5] };
      if (m[6] !== undefined) change.comment = m[6];
      out.push(change);
    } else out.push({ kind: 'comment', start, end, accepted: '', rejected: '', comment: m[7] });
  }
  return out;
}

/** The change the caret is in or touching (start ≤ offset ≤ end), or null. */
export function criticChangeAt(text: string, offset: number): CriticChange | null {
  return findCriticChanges(text).find((c) => offset >= c.start && offset <= c.end) || null;
}

/** Where an offset lands once the given changes are replaced. */
function mapOffset(offset: number, changes: CriticChange[], pick: (c: CriticChange) => string): number {
  let delta = 0;
  for (const c of changes) {
    const replacement = pick(c);
    if (offset >= c.end) delta += replacement.length - (c.end - c.start);
    else if (offset > c.start) return c.start + delta + replacement.length;
    else break;
  }
  return offset + delta;
}

function applyChanges(text: string, changes: CriticChange[], pick: (c: CriticChange) => string): string {
  let out = '';
  let pos = 0;
  for (const c of changes) {
    out += text.slice(pos, c.start) + pick(c);
    pos = c.end;
  }
  return out + text.slice(pos);
}

function resolveOne(text: string, offset: number, accept: boolean): CriticEdit | null {
  const change = criticChangeAt(text, offset);
  if (!change) return null;
  const replacement = accept ? change.accepted : change.rejected;
  const next = text.slice(0, change.start) + replacement + text.slice(change.end);
  const caret = change.start + replacement.length;
  return { text: next, selStart: caret, selEnd: caret };
}

/** Accept the change at the caret; null when the caret is in none. */
export function acceptCriticChange(text: string, offset: number): CriticEdit | null {
  return resolveOne(text, offset, true);
}

/** Reject the change at the caret; null when the caret is in none. */
export function rejectCriticChange(text: string, offset: number): CriticEdit | null {
  return resolveOne(text, offset, false);
}

function resolveAll(text: string, selStart: number, selEnd: number, accept: boolean): CriticEdit {
  const src = typeof text === 'string' ? text : '';
  const changes = findCriticChanges(src);
  const pick = (c: CriticChange) => (accept ? c.accepted : c.rejected);
  if (!changes.length) return { text: src, selStart, selEnd };
  return {
    text: applyChanges(src, changes, pick),
    selStart: mapOffset(selStart, changes, pick),
    selEnd: mapOffset(selEnd, changes, pick),
  };
}

/** Accept every change (comments go, highlights are unwrapped). */
export function acceptAllCritic(text: string): string {
  return resolveAll(text, 0, 0, true).text;
}

/** Reject every change (comments go, highlights are unwrapped). */
export function rejectAllCritic(text: string): string {
  return resolveAll(text, 0, 0, false).text;
}

/** Accept / reject all, keeping the selection on the same text. */
export function resolveAllCritic(text: string, selStart: number, selEnd: number, accept: boolean): CriticEdit {
  return resolveAll(text, selStart, selEnd, accept);
}
