// 우리 편집기(TipTap)에서 복사할 때 클립보드 평문(text/plain)을 만든다.
//
// ★ 2026-10-29 Irene: *"우리 문서에서 편집하다가 복사한 내용을 Q talk에 붙이면 행 사이에 빈 줄간격이 많이 들어가서"*
//   TipTap 기본 ClipboardTextSerializer 는 블록이 시작할 때마다 "\n\n" 을 붙이고, 겹친 블록(목록 → 항목 → 문단)은
//   겹친 수만큼 또 붙인다. 우리 문서는 Enter 한 번 = 새 문단이라 «줄 하나» 마다 빈 줄이 끼고, 목록은 빈 줄 3개가 됐다.
//   평문을 그대로 받는 곳(Q talk 입력창·메일 평문·메모장)에 붙이면 화면과 다른 모양이 된다.
//   → 글이 든 블록(문단·제목·코드) 사이에 "\n" 하나, 빈 문단은 빈 줄 하나, Shift+Enter 는 "\n".
//   서식 복사(text/html)는 건드리지 않는다 — 문서끼리 붙여넣기는 그대로.
import type { Slice, Node as PMNode } from '@tiptap/pm/model';

export function clipboardPlainText(slice: Slice): string {
  return slice.content.textBetween(0, slice.content.size, '\n', (leaf: PMNode) => (leaf.type.name === 'hardBreak' ? '\n' : ''));
}
