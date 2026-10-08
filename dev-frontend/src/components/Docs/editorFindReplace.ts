// 문서 편집기 찾기·바꾸기 — ProseMirror 플러그인 (2026-10-08, Irene: "문서 수정이 찾기, 문구 교체 등 문서들 기본 기능도 추가해줘")
//
// ★ 찾은 자리는 **꾸밈(decoration)** 으로만 칠한다 — 문서 JSON 에 표시를 넣으면 저장·버전·공유에 실려 나간다.
// ★ 바꾸기는 `tr.insertText(글, from, to)` — 그 자리의 서식(굵게·링크 등)을 그대로 이어받는다.
//   «모두 바꾸기» 는 **한 트랜잭션**이라 실행 취소(⌘Z) 한 번에 통째로 돌아온다.
// ★ 글은 **문단(텍스트 블록) 안에서만** 잇는다. 문단 경계를 넘는 찾기는 하지 않는다
//   (워드·구글 문서도 같다). 문단 안의 이미지·줄바꿈 같은 칸은 '￼' 한 글자로 끼워
//   검색어가 그 너머로 이어 붙지 않게 한다.
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface FindMatch { from: number; to: number }
export interface FindState {
  query: string;
  caseSensitive: boolean;
  matches: FindMatch[];
  current: number;          // matches 안의 번호, 없으면 -1
  deco: DecorationSet;
}

export const findReplaceKey = new PluginKey<FindState>('pqFindReplace');

const OBJ = '￼';

// 대소문자 무시 비교용 — 글자별로 낮추되 길이가 바뀌는 글자(İ 등)는 그대로 둔다.
//   길이가 바뀌면 글자 번호 ↔ 문서 위치 대응이 어긋난다.
function fold(s: string): string {
  let out = '';
  for (const ch of s) {
    const l = ch.toLowerCase();
    out += l.length === ch.length ? l : ch;
  }
  return out;
}

export function findMatches(doc: PMNode, query: string, caseSensitive: boolean): FindMatch[] {
  if (!query) return [];
  const needle = caseSensitive ? query : fold(query);
  const out: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const at: number[] = [];   // 글자 번호(UTF-16) → 문서 위치
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        const s = child.text || '';
        for (let i = 0; i < s.length; i++) at.push(start + i);
        text += s;
      } else {
        at.push(start);
        text += OBJ;
      }
    });
    const hay = caseSensitive ? text : fold(text);
    let i = hay.indexOf(needle);
    while (i !== -1) {
      const last = i + needle.length - 1;
      out.push({ from: at[i], to: at[last] + 1 });
      i = hay.indexOf(needle, i + needle.length);
    }
    return false;   // 텍스트 블록 안쪽은 이미 다 봤다
  });
  return out;
}

function build(doc: PMNode, matches: FindMatch[], current: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty;
  return DecorationSet.create(doc, matches.map((m, i) =>
    Decoration.inline(m.from, m.to, { class: i === current ? 'pq-find-match pq-find-current' : 'pq-find-match' })));
}

type Meta = { query?: string; caseSensitive?: boolean; current?: number };

const EMPTY: FindState = { query: '', caseSensitive: false, matches: [], current: -1, deco: DecorationSet.empty };

export const FindReplace = Extension.create({
  name: 'pqFindReplace',
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findReplaceKey,
        state: {
          init: () => EMPTY,
          apply(tr: Transaction, prev: FindState, _old: EditorState, next: EditorState): FindState {
            const meta = tr.getMeta(findReplaceKey) as Meta | undefined;
            if (!meta && !tr.docChanged) return prev;
            const query = meta?.query ?? prev.query;
            const caseSensitive = meta?.caseSensitive ?? prev.caseSensitive;
            if (!query) return { ...EMPTY, caseSensitive };
            const matches = findMatches(next.doc, query, caseSensitive);
            let current = meta?.current ?? prev.current;
            if (meta?.current === undefined && (meta?.query !== undefined || meta?.caseSensitive !== undefined)) {
              // 검색어가 바뀌면 커서 뒤 첫 결과부터 — 문서 맨 위로 튀지 않게
              const head = next.selection.from;
              const idx = matches.findIndex((m) => m.from >= head);
              current = matches.length ? (idx === -1 ? 0 : idx) : -1;
            }
            if (!matches.length) current = -1;
            else if (current < 0 || current >= matches.length) current = Math.min(Math.max(current, 0), matches.length - 1);
            return { query, caseSensitive, matches, current, deco: build(next.doc, matches, current) };
          },
        },
        props: {
          decorations(state) { return findReplaceKey.getState(state)?.deco ?? DecorationSet.empty; },
        },
      }),
    ];
  },
});

export function getFindState(editor: Editor): FindState {
  return findReplaceKey.getState(editor.state) ?? EMPTY;
}

/** 지금 결과로 화면을 옮긴다 — 선택도 그 자리로 둔다(바로 고쳐 쓰거나 ⌘B 를 누를 수 있게). */
function reveal(editor: Editor) {
  const st = getFindState(editor);
  const m = st.matches[st.current];
  if (!m) return;
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, m.from, m.to));
  editor.view.dispatch(tr);
  // ★ PM 의 scrollIntoView 는 sticky 툴바 밑으로 숨긴다 — 가운데로 직접 옮긴다.
  requestAnimationFrame(() => {
    const el = editor.view.dom.querySelector('.pq-find-current') as HTMLElement | null;
    el?.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
}

export function setFindQuery(editor: Editor, query: string, caseSensitive: boolean, jump = true) {
  editor.view.dispatch(editor.state.tr.setMeta(findReplaceKey, { query, caseSensitive }));
  if (jump) reveal(editor);
}

export function clearFind(editor: Editor) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(findReplaceKey, { query: '' }));
}

export function stepFind(editor: Editor, dir: 1 | -1) {
  const st = getFindState(editor);
  if (!st.matches.length) return;
  const n = st.matches.length;
  const current = ((st.current < 0 ? 0 : st.current + dir) % n + n) % n;
  editor.view.dispatch(editor.state.tr.setMeta(findReplaceKey, { current }));
  reveal(editor);
}

/** 지금 결과 하나를 바꾸고 다음 결과로 간다. 바꾼 수(0|1)를 돌려준다. */
export function replaceCurrent(editor: Editor, replacement: string): number {
  const st = getFindState(editor);
  const m = st.matches[st.current];
  if (!m) return 0;
  const keep = st.current;
  const tr = editor.state.tr;
  if (replacement) tr.insertText(replacement, m.from, m.to);
  else tr.delete(m.from, m.to);
  // 바뀐 글이 다시 걸리지 않게, 바꾼 자리 **뒤**의 첫 결과를 현재로 둔다
  const after = tr.mapping.map(m.to);
  tr.setMeta(findReplaceKey, { current: keep });
  editor.view.dispatch(tr);
  const next = getFindState(editor);
  if (next.matches.length) {
    const idx = next.matches.findIndex((x) => x.from >= after);
    editor.view.dispatch(editor.state.tr.setMeta(findReplaceKey, { current: idx === -1 ? 0 : idx }));
    reveal(editor);
  }
  return 1;
}

/** 모두 바꾸기 — 한 트랜잭션(실행 취소 한 번). 바꾼 수를 돌려준다. */
export function replaceAll(editor: Editor, replacement: string): number {
  const st = getFindState(editor);
  if (!st.matches.length) return 0;
  const tr = editor.state.tr;
  // 뒤에서부터 바꾸면 앞 위치가 밀리지 않는다
  for (let i = st.matches.length - 1; i >= 0; i--) {
    const m = st.matches[i];
    if (replacement) tr.insertText(replacement, m.from, m.to);
    else tr.delete(m.from, m.to);
  }
  editor.view.dispatch(tr);
  return st.matches.length;
}

export const findReplaceEditorCss = `
  & .pq-find-match { background: #FEF08A; border-radius: 2px; }
  & .pq-find-current { background: #FB923C; color: #0F172A; box-shadow: 0 0 0 1px #EA580C; }
`;
