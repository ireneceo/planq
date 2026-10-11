// 문서 안 표의 칸 채우기 색 (2026-10-12) — 칸 · 열 · 행 단위로 칠한다.
//   Irene: "문서 표에서 열에 색상넣게 기능 넣어줄 수 있어?"
//   ★ 색은 칸(td/th)의 속성 `backgroundColor` 로 저장한다 — 글자 배경(textStyle mark)과 다른 축이다.
//     글자 배경은 글자 뒤만, 이것은 칸 전체를 칠한다.
//   ★ 이 확장(PqTableCell·PqTableHeader)은 보기 변환(utils/postContentHtml)에도 **같이** 쓴다 —
//     기본 TableCell 로 변환하면 속성을 몰라 보기·게스트 화면에서 색이 빠진다.
//   ★ 서버 변환(pdfTemplates·docxService)은 #rrggbb 모양만 받는다. 팔레트 값도 그 모양이다.
import type { Editor } from '@tiptap/core';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { selectedRect, isInTable } from '@tiptap/pm/tables';
import { CELL_FILLS } from './textStylePalette';

const HEX6 = /^#[0-9a-f]{6}$/i;

/** 브라우저가 돌려주는 rgb(…) 도 #rrggbb 로 — 그 밖의 값은 버린다 */
function toHex(v: string | null | undefined): string | null {
  const s = String(v || '').trim();
  if (HEX6.test(s)) return s.toUpperCase();
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(1|1\.0+)\s*)?\)$/i.exec(s);
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const fillAttribute = {
  backgroundColor: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => toHex(el.getAttribute('data-fill') || el.style.backgroundColor),
    renderHTML: (attrs: Record<string, unknown>) => {
      const v = toHex(attrs.backgroundColor as string);
      return v ? { 'data-fill': v, style: `background-color:${v}` } : {};
    },
  },
};

export const PqTableCell = TableCell.extend({
  addAttributes() { return { ...this.parent?.(), ...fillAttribute }; },
});
export const PqTableHeader = TableHeader.extend({
  addAttributes() { return { ...this.parent?.(), ...fillAttribute }; },
});

export type FillScope = 'cell' | 'col' | 'row';

/** 지금 커서(또는 고른 칸들의 첫 칸)의 채우기 색 → 팔레트 key */
export function currentCellFillKey(editor: Editor): string {
  const { state } = editor;
  if (!isInTable(state)) return 'none';
  try {
    const rect = selectedRect(state);
    const pos = rect.map.cellsInRect(rect)[0];
    const v = toHex(rect.table.nodeAt(pos)?.attrs.backgroundColor);
    return (v && CELL_FILLS.find((f) => f.value === v)?.key) || 'none';
  } catch { return 'none'; }
}

/** 고른 칸(scope='cell') · 그 칸들의 열 전체 · 행 전체를 칠한다. value=null 이면 지운다. */
export function setCellFill(editor: Editor, scope: FillScope, value: string | null): boolean {
  const { state, view } = editor;
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  const { map, table, tableStart } = rect;
  const area = scope === 'col' ? { left: rect.left, right: rect.right, top: 0, bottom: map.height }
    : scope === 'row' ? { left: 0, right: map.width, top: rect.top, bottom: rect.bottom }
      : { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  const fill = value ? toHex(value) : null;
  const tr = state.tr;
  // 병합 칸은 cellsInRect 가 한 번만 준다 — setNodeMarkup 은 위치를 바꾸지 않으므로 같은 tr 에서 이어 고쳐도 된다
  for (const pos of map.cellsInRect(area)) {
    const node = table.nodeAt(pos);
    if (!node || (node.attrs.backgroundColor || null) === fill) continue;
    tr.setNodeMarkup(tableStart + pos, null, { ...node.attrs, backgroundColor: fill });
  }
  if (!tr.docChanged) return false;
  view.dispatch(tr);
  return true;
}
