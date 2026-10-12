// 문서 안 표의 편집 메뉴 — 표 오른쪽 위 모서리 손잡이 [표 ⋯] → 누르면 행·열·칸 색 메뉴.
//   Irene 2026-10-12: *"표 만들고 수정할 때 커서를 넣으면 행, 열 추가할지 뜨는데 내용을 수정할 때는 너무 불편"*
//   예전엔 표 안 커서마다 메뉴 전체가 커서 바로 위에 떠 윗줄 칸을 가렸다. 지금은 손잡이만 표 **바깥** 위에 둔다.
//   글자를 치면 다시 접고, 표 밖으로 나가면 사라진다. 툴바의 표 묶음(열·행 추가·삭제)은 그대로다.
//   회귀: node scripts/e2e/run.js --suite tablemenu
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { currentCellFillKey, setCellFill } from './editorTableCellFill';
import { CellFillButton } from './CellFillButton';
import { distributeTableColumnsEvenly } from './editorTableFit';   // 표 열 폭 맞춤(운영 #311)

const TableBubbleMenu: React.FC<{ editor: Editor }> = ({ editor }) => {
  const { t } = useTranslation('qdocs');
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  // 표 밖으로 나가면 표 메뉴를 다시 접는다(다음 표에 들어갈 때는 손잡이부터).
  useEffect(() => {
    const onSel = () => { if (!editor.isActive('table')) setTableMenuOpen(false); };
    editor.on('selectionUpdate', onSel);
    return () => { editor.off('selectionUpdate', onSel); };
  }, [editor]);
  // 손잡이 ↔ 펼친 메뉴는 폭이 달라 위치를 다시 잡아야 한다(오른쪽 끝 기준이라 안 하면 오른쪽으로 삐져나간다).
  useEffect(() => {
    if (editor.isDestroyed) return;
    const id = requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('pqTableMenu', 'updatePosition'));
    });
    return () => cancelAnimationFrame(id);
  }, [editor, tableMenuOpen]);
  // 펼친 채 글자를 치면 접는다 — 메뉴는 구조를 바꿀 때만 필요하다.
  useEffect(() => {
    if (!tableMenuOpen) return;
    const dom = editor.view.dom;
    const onKey = (e: KeyboardEvent) => { if (!e.metaKey && !e.ctrlKey) setTableMenuOpen(false); };
    dom.addEventListener('keydown', onKey);
    return () => dom.removeEventListener('keydown', onKey);
  }, [editor, tableMenuOpen]);

  return (
        <BubbleMenu className="pq-editor-bubble" editor={editor} pluginKey="pqTableMenu"
          shouldShow={({ editor: ed }) => ed.isActive('table')}
          getReferencedVirtualElement={() => tableAnchor(editor)}
          options={{ placement: 'top-end', offset: 6, flip: false, shift: { padding: 8 } }}>
          {!tableMenuOpen ? (
            <TableHandle type="button" data-testid="editor-table-menu-open"
              title={t('editor.table.menuOpen', '표 편집 (행·열 추가·삭제, 칸 색)') as string}
              aria-label={t('editor.table.menuOpen', '표 편집 (행·열 추가·삭제, 칸 색)') as string}
              onMouseDown={(e) => { e.preventDefault(); setTableMenuOpen(true); }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/>
              </svg>
              {t('editor.table.menuShort', '표')} ⋯
            </TableHandle>
          ) : (
          <TableBubble data-testid="editor-table-menu">
            <TableBubbleGroup>
              <TableBubbleBtn type="button" title={t('editor.table.addColLeft', '왼쪽에 열 추가') as string}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addColumnBefore().run(); }}>＋{t('editor.table.colLeft', '열←')}</TableBubbleBtn>
              <TableBubbleBtn type="button" title={t('editor.table.addColRight', '오른쪽에 열 추가') as string}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addColumnAfter().run(); }}>＋{t('editor.table.colRight', '열→')}</TableBubbleBtn>
              <TableBubbleBtn type="button" title={t('editor.table.addRowAbove', '위에 행 추가') as string}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addRowBefore().run(); }}>＋{t('editor.table.rowAbove', '행↑')}</TableBubbleBtn>
              <TableBubbleBtn type="button" title={t('editor.table.addRowBelow', '아래에 행 추가') as string}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addRowAfter().run(); }}>＋{t('editor.table.rowBelow', '행↓')}</TableBubbleBtn>
            </TableBubbleGroup>
            <TableBubbleSep />
            <TableBubbleGroup>
              {/* 운영 #311 — 열 폭 고정(균등). 자유 조절은 그대로 — 끌면 다시 달라진다.
                  ★ 2026-09-13 — 문구도 같이 바꿨다. 동작이 "160px 고정" 에서 "본문 폭에 맞춰 나눔" 으로
                    바뀌었는데 문구가 그대로면 거짓말이 된다(memory feedback_new_behavior_makes_copy_lie). */}
              <TableBubbleBtn type="button" data-testid="editor-table-even-cols"
                title={t('editor.table.evenColsHint', '표를 본문 폭에 맞추고 열을 같은 너비로 나눕니다 (드래그로 다시 조절 가능)') as string}
                onMouseDown={(e) => { e.preventDefault(); distributeTableColumnsEvenly(editor); }}>⇹{t('editor.table.evenCols', '폭 맞춤')}</TableBubbleBtn>
            </TableBubbleGroup>
            <TableBubbleSep />
            <TableBubbleGroup>
              <CellFillButton current={currentCellFillKey(editor)} onPick={(scope, item) => { setCellFill(editor, scope, item.value); }} />
            </TableBubbleGroup>
            <TableBubbleSep />
            <TableBubbleGroup>
              <TableBubbleBtn type="button" title={t('editor.table.delCol', '열 삭제') as string}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteColumn().run(); }}>−{t('editor.table.col', '열')}</TableBubbleBtn>
              <TableBubbleBtn type="button" title={t('editor.table.delRow', '행 삭제') as string}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteRow().run(); }}>−{t('editor.table.row', '행')}</TableBubbleBtn>
              <TableBubbleBtn type="button" $danger title={t('editor.table.delTable', '표 삭제') as string}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteTable().run(); }}>✕{t('editor.table.table', '표')}</TableBubbleBtn>
            </TableBubbleGroup>
            <TableBubbleSep />
            <TableBubbleBtn type="button" data-testid="editor-table-menu-close"
              title={t('editor.table.menuClose', '메뉴 접기') as string} aria-label={t('editor.table.menuClose', '메뉴 접기') as string}
              onMouseDown={(e) => { e.preventDefault(); setTableMenuOpen(false); }}>✕</TableBubbleBtn>
          </TableBubble>
          )}
        </BubbleMenu>
  );
};

export default TableBubbleMenu;

// 표 메뉴의 기준점 — 커서가 아니라 **표의 위 모서리**. 커서 기준이면 메뉴가 바로 윗줄 칸을 덮는다.
//   표 머리가 화면(툴바) 위로 스크롤돼 나가면 지금 칸의 위 모서리로 내려온다(손잡이 하나 크기만 겹친다).
function tableAnchor(editor: Editor) {
  const { $from } = editor.state.selection;
  let tablePos = -1;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') { tablePos = $from.before(d); break; }
  }
  if (tablePos < 0) return null;
  const dom = editor.view.nodeDOM(tablePos) as HTMLElement | null;
  const tableEl = (dom?.querySelector?.('table') || dom) as HTMLElement | null;
  if (!tableEl?.getBoundingClientRect) return null;
  const cellAt = () => {
    const d = editor.view.domAtPos(editor.state.selection.from).node as HTMLElement;
    const el = (d.nodeType === 1 ? d : d.parentElement) as HTMLElement | null;
    return el?.closest?.('td, th') as HTMLElement | null;
  };
  return {
    getBoundingClientRect: () => {
      const r = tableEl.getBoundingClientRect();
      const wrap = (tableEl.closest('.tableWrapper') as HTMLElement | null)?.getBoundingClientRect();
      const right = wrap ? Math.min(r.right, wrap.right) : r.right;
      // 편집기 sticky 툴바 아래로 표 머리가 숨었으면 지금 칸 기준
      const head = tableEl.closest('[data-pq-editor-wrap]')?.querySelector('[data-pq-editor-head]')?.getBoundingClientRect();
      const limit = Math.max(head ? head.bottom : 0, 0) + 34;
      let top = r.top;
      if (top < limit) { const c = cellAt()?.getBoundingClientRect(); if (c) top = Math.max(c.top, Math.min(limit, r.bottom)); }
      return { x: right, y: top, left: right, right, top, bottom: top, width: 0, height: 0 } as DOMRect;
    },
  };
}
// 접힌 손잡이 — 표 오른쪽 위 모서리 바깥의 작은 알약
const TableHandle = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  height: 32px; padding: 0 10px; border-radius: 6px;
  border: 1px solid #CBD5E1; background: #FFF; color: #475569;
  font-size: 0.6875rem; font-weight: 700; cursor: pointer; white-space: nowrap;
  box-shadow: 0 2px 6px rgba(15,23,42,0.12);
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
// 표 행/열 플로팅 컨트롤 (손잡이를 눌렀을 때 노출)
const TableBubble = styled.div`
  display: inline-flex; align-items: center; gap: 4px; padding: 4px;
  background: #0F172A; border-radius: 8px;
  box-shadow: 0 4px 12px rgba(15,23,42,0.25);
  /* 폰 — 한 줄이면 창보다 넓다. 접어서 두 줄로 */
  max-width: calc(100vw - 16px); flex-wrap: wrap; justify-content: flex-end;
`;
const TableBubbleGroup = styled.div`display: inline-flex; align-items: center; gap: 2px;`;
const TableBubbleSep = styled.div`width: 1px; height: 18px; background: #334155; margin: 0 2px;`;
const TableBubbleBtn = styled.button<{ $danger?: boolean }>`
  border: none; background: transparent;
  color: ${p => p.$danger ? '#FCA5A5' : '#E2E8F0'};
  padding: 4px 8px; border-radius: 5px;
  font-size: 0.6875rem; font-weight: 700; cursor: pointer; white-space: nowrap;
  &:hover { background: ${p => p.$danger ? '#7F1D1D' : '#334155'}; color: #FFF; }
`;

