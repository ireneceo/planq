// 모바일에서 «# »·«- »·«1. »·«> » 를 쳐도 제목·목록·인용이 안 되던 것 (2026-10-24)
//   Irene: "모바일에서 문서에 # ## 이런거 붙은 글자 크기 마킹 붙인 내용도 적용이 안돼."
//   원인: TipTap 입력 규칙(@tiptap/core InputRule.run)은 첫 줄에서 `view.composing` 이면 버린다.
//   iOS·안드로이드 한글 자판은 «#»·스페이스를 조합 세션 안에서 넣는 경우가 있고, 보완 경로(compositionend 뒤 setTimeout(0))는
//   그 순간 문서에 아직 공백이 반영되지 않아 정규식(`^#{1,3}\s$`)이 맞지 않는다 → 평문 «# » 가 그대로 남는다.
//   그래서 «언제 쳤나» 가 아니라 **반영된 결과**를 본다: 사람이 친 변경 뒤 조합이 끝난 상태에서, 커서가 든 문단이
//   정확히 «# » 이고 커서가 끝이면 그 문단을 바꾼다. 데스크탑처럼 TipTap 규칙이 먼저 바꿨으면 문단이 아니게 되므로 여기서 빠진다.
//   PostEditor(문서·메모)와 RichEditor(업무 설명·메일·지식)가 같이 쓴다.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { findWrapping } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';

const key = new PluginKey('pqMarkdownShortcut');

/** 사람이 친 입력이 아닌 트랜잭션 — 되돌리기·불러오기·붙여넣기·원격 반영은 손대지 않는다. */
function isTyped(tr: Transaction): boolean {
  if (!tr.docChanged) return false;
  if (tr.getMeta('history$')) return false;            // 되돌리기 — 바꾼 것을 되돌렸는데 다시 바꾸면 «# » 를 쓸 길이 없다
  if (tr.getMeta('addToHistory') === false) return false;
  if (tr.getMeta('preventUpdate')) return false;       // setContent(불러오기)
  if (tr.getMeta('paste') || tr.getMeta('uiEvent') === 'paste' || tr.getMeta('uiEvent') === 'drop') return false;
  return true;
}

export const MarkdownShortcutFix = Extension.create({
  name: 'pqMarkdownShortcutFix',
  addProseMirrorPlugins() {
    let view: EditorView | null = null;
    return [new Plugin({
      key,
      view: (v) => { view = v; return { destroy: () => { view = null; } }; },
      appendTransaction: (trs, oldState, state) => {
        if (!view || view.composing) return null;          // 조합 중에 문서를 바꾸면 자모가 깨진다 — 조합이 끝난 반영 때 본다
        if (!trs.some(isTyped)) return null;
        const sel = state.selection;
        if (!(sel instanceof TextSelection) || !sel.$cursor) return null;
        const $c = sel.$cursor;
        const para = $c.parent;
        if (para.type.name !== 'paragraph' || $c.parentOffset !== para.content.size) return null;
        const text = para.textContent;
        if (oldState.selection.$from.parent.textContent === text) return null;   // 이번에 친 글이 아니다
        const m = /^(#{1,3}|[-*+]|\d+\.|>)[\s ]$/.exec(text);
        if (!m) return null;
        const { schema } = state;
        const mark = m[1];
        const start = $c.start();
        const tr = state.tr.delete(start, start + text.length);
        const $s = tr.doc.resolve(start);
        const range = $s.blockRange();
        if (mark[0] === '#') {
          const heading = schema.nodes.heading;
          const idx = $s.index(-1);
          if (!heading || !$s.node(-1).canReplaceWith(idx, idx + 1, heading)) return null;
          tr.setBlockType(start, start, heading, { level: mark.length });
        } else {
          const type = mark === '>' ? schema.nodes.blockquote
            : /\d/.test(mark) ? schema.nodes.orderedList : schema.nodes.bulletList;
          if (!type || !range) return null;
          const attrs = type.name === 'orderedList' ? { start: parseInt(mark, 10) } : undefined;
          const wrapping = findWrapping(range, type, attrs);
          if (!wrapping) return null;
          tr.wrap(range, wrapping);
        }
        return tr;
      },
    })];
  },
});
