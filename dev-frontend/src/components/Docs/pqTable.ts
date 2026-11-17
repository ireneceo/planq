// 표 한 벌 — 편집·보기·HTML 변환이 **같은 표시 기준**을 쓴다 (2026-11-04).
//
// Irene: *"이 문서는 위 아래 표 각각이 왜 잘리고 안잘리고 달라? 편집할 때 표에 대한처리,
//   반응형에서 표시할 기준방식을 통일해서 다 제대로 적용해야 해."*
//
// ■ 원인(실측, dev 문서 7500 · 1440/820/390)
//   TipTap 표는 열 폭(colwidth)을 «그 사람 화면의 px» 로 저장하고, 그려 줄 때 표에 **인라인**
//   `width: 합계px`(모든 열에 폭이 있을 때) 또는 `min-width: 합계px` 를 박는다. 보기 CSS 의 width:100% 는
//   인라인에 져서 «열 폭이 다 저장된 표» 만 화면 밖으로 잘렸다(820폭 105~505px, 스크롤도 없음) — 폭 없는 표는 100%
//   로 눌려 안 잘렸다. 그래서 «위 표는 잘리고 아래 표는 안 잘림». 편집은 반대로 내용 폭/저장 px + 가로 스크롤이라
//   같은 표가 화면마다 셋으로 갈렸다. 그리고 table-layout:fixed 에서 px 열은 **줄어들지 않는다**
//   (표 폭 = max(width, 열 합)) — CSS 만으로는 못 고친다.
//
// ■ 기준(Fable 설계 판정 A, 2026-11-04) — 어느 화면·어느 폭이든 하나:
//   ① 표 = 본문 폭 100%. 저장된 열 폭은 **비율**로만 쓴다(폭 없는 열 = 저장된 열들의 평균).
//      ★ 2026-11-17 Irene «기본 표는 열을 고정으로 나누지 말고 내용 크기에 따라 줄고, 남는 여유는 다른 열에»:
//        열 폭이 **하나도 저장되지 않은 표**(새로 넣은 기본 표·붙여넣은 표)는 균등 대신 **내용 기준**
//        (table-layout:auto) — 짧은 열(번호·날짜)은 내용만큼(하한 96), 남는 폭은 글이 긴 열이 가져간다.
//        손으로 끌거나 «열 고르게» 를 누른 표는 그때부터 그 비율로 고정(사용자가 정한 폭이 이긴다). 편집·보기 같은 기준.
//   ② 칸 하한 96px — `열 수 × 96 > 본문 폭` 일 때만 표를 감싼 .tableWrapper 안에서 가로 스크롤. 잘림 0.
//   ③ 저장 데이터(content_json · colwidth px 숫자)는 바꾸지 않는다 — 표시만.
//   그래서 열은 % 로, 하한은 표 인라인 min-width 로 내보낸다(우리 renderHTML · 우리 View 둘 다 같은 함수).
//
// ■ 드래그(편집) — prosemirror-tables 는 드래그 시작 폭을 «저장 px» 로 잡는다. 비율로 줄여 보이던 표면
//   손잡이가 튄다. 그래서 손잡이를 누르는 순간 그 표의 열 폭을 **지금 보이는 px** 로 굳히고(배율 1),
//   놓으면 늘어난 만큼 **오른쪽 이웃 열이 양보**한다(합 그대로 → 표는 계속 본문 폭, 스냅 없음 — Word·구글 문서와 같다).
//   표가 늘 100% 라 마지막 경계는 뜻이 없다 → lastColumnResizable:false.
import { Table } from '@tiptap/extension-table';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import type { EditorView, NodeView, ViewMutationRecord } from '@tiptap/pm/view';
import { columnResizingPluginKey, TableMap } from '@tiptap/pm/tables';

/** 칸 하한 — 편집·보기·«열 고르게»(editorTableFit) 공통. 이보다 좁게 눌러 넣으면 글이 세로로 무너진다. */
export const TABLE_MIN_COL = 96;

/** 첫 행 기준 열마다 저장 폭(px) — 없으면 null. colspan 은 칸 수만큼 펼친다. */
function storedWidths(node: ProseMirrorNode): (number | null)[] {
  const out: (number | null)[] = [];
  const row = node.firstChild;
  if (!row) return out;
  row.forEach((cell) => {
    const span = Number(cell.attrs.colspan) || 1;
    const cw = cell.attrs.colwidth as number[] | null;
    for (let j = 0; j < span; j += 1) {
      const w = cw && cw[j];
      out.push(typeof w === 'number' && w > 0 ? w : null);
    }
  });
  return out;
}

/** 표시 계획 — 열마다 % (null = 열 폭 저장 없음 → 내용 기준), 열 수, 표 min-width(px). 편집 View · renderHTML 가 같이 쓴다. */
export function tableLayout(node: ProseMirrorNode): { pcts: number[] | null; cols: number; minWidth: number } {
  const ws = storedWidths(node);
  const n = ws.length;
  if (!n) return { pcts: [], cols: 0, minWidth: 0 };
  const set = ws.filter((w): w is number => w != null);
  if (!set.length) return { pcts: null, cols: n, minWidth: n * TABLE_MIN_COL };
  const avg = set.reduce((a, b) => a + b, 0) / set.length;
  const weights = ws.map((w) => (w == null ? avg : w));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const pcts = weights.map((w) => Math.round((w / sum) * 1000000) / 10000);
  return { pcts, cols: n, minWidth: n * TABLE_MIN_COL };
}

// ★ table-layout:fixed 는 열 폭이 저장된 표에만 싣는다 — 그래야 열 % 가 지켜지고 글 길이로 열이 늘지 않는다.
//   폭 없는 표는 CSS 조각 기본 auto(내용 기준 + 칸 하한 96) — 마크다운·외부 HTML 표와 같은 길.
const tableStyle = (minWidth: number, fixed: boolean) => `width:100%;min-width:${minWidth}px${fixed ? ';table-layout:fixed' : ''}`;

/** 편집 화면 View — TipTap TableView 와 같은 모양(.tableWrapper > table > colgroup + tbody), 열만 %.
 *  ★ colgroup 은 table 의 **첫 자식**이어야 한다 — prosemirror-tables 가 드래그 중 `dom.firstChild` 에 px 를 직접 쓴다. */
export class PqTableView implements NodeView {
  node: ProseMirrorNode;
  dom: HTMLDivElement;
  table: HTMLTableElement;
  colgroup: HTMLTableColElement;
  contentDOM: HTMLTableSectionElement;

  constructor(node: ProseMirrorNode) {
    this.node = node;
    this.dom = document.createElement('div');
    this.dom.className = 'tableWrapper';
    this.table = this.dom.appendChild(document.createElement('table'));
    this.colgroup = this.table.appendChild(document.createElement('colgroup'));
    this.render();
    this.contentDOM = this.table.appendChild(document.createElement('tbody'));
  }

  private render() {
    const { pcts, cols: n, minWidth } = tableLayout(this.node);
    const cols = this.colgroup.children;
    for (let i = 0; i < n; i += 1) {
      let col = cols[i] as HTMLElement | undefined;
      if (!col) col = this.colgroup.appendChild(document.createElement('col'));
      col.style.cssText = pcts ? `width:${pcts[i]}%` : '';
    }
    while (this.colgroup.children.length > n) this.colgroup.lastChild!.remove();
    this.table.style.cssText = tableStyle(minWidth, !!pcts);
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    const target = mutation.target as Node;
    return this.dom.contains(target) && !this.contentDOM.contains(target)
      && (mutation.type === 'attributes' || mutation.type === 'childList' || mutation.type === 'characterData');
  }
}

/** 표의 모든 행에서 열 폭(px)을 widths 로 맞춘다. colspan 칸은 칸 수만큼. 바뀐 것이 없으면 false. */
function writeWidths(tr: Transaction, tablePos: number, table: ProseMirrorNode, widths: (number | null)[]): boolean {
  let changed = false;
  table.forEach((row, rowOffset) => {
    let col = 0;
    row.forEach((cell, cellOffset) => {
      const span = Number(cell.attrs.colspan) || 1;
      const raw = Array.from({ length: span }, (_, i) => widths[Math.min(col + i, widths.length - 1)]);
      // 하나라도 «폭 없음» 이면 그 칸은 폭 없음(null) — 라이브러리와 같은 모양
      const next: number[] | null = raw.every((w): w is number => typeof w === 'number') ? raw : null;
      col += span;
      const cur = cell.attrs.colwidth as number[] | null;
      if (next == null ? cur == null : (cur && cur.length === span && cur.every((w, i) => w === next[i]))) return;
      tr.setNodeMarkup(tablePos + 1 + rowOffset + 1 + cellOffset, undefined, { ...cell.attrs, colwidth: next });
      changed = true;
    });
  });
  return changed;
}

type DragMemo = { tablePos: number; col: number; frozen: number[]; original: (number | null)[] };
const freezeKey = new PluginKey('pqTableFreeze');

/** 손잡이 누름 → 보이는 px 로 굳힘 · 놓음 → 오른쪽 이웃이 양보. columnResizing 보다 **앞에** 둔다.
 *  ★ 양보는 appendTransaction 으로 낸다 — 라이브러리의 폭 저장과 **같은 실행 취소 묶음**이 된다
 *    (따로 dispatch 했더니 Ctrl+Z 한 번에 양보만 되돌아가고 끈 열은 그대로였다 — 실측). */
function freezeOnResizePlugin() {
  let memo: DragMemo | null = null;
  return new Plugin({
    key: freezeKey,
    appendTransaction(trs, _old, state) {
      if (!memo || !trs.some((t) => t.docChanged && t.getMeta('addToHistory') !== false)) return null;
      const m = memo; memo = null;
      const table = state.doc.nodeAt(m.tablePos);
      if (!table || table.type.name !== 'table') return null;
      const now = storedWidths(table);
      const dragged = now[m.col];
      const nb = m.col + 1;
      if (dragged == null || nb >= m.frozen.length) return null;
      const delta = dragged - m.frozen[m.col];
      if (!delta) return null;
      const widths = now.map((w, i) => (w == null ? m.frozen[i] : w));
      // 이웃이 하한(96)까지만 양보한다 — 더 끌면 끈 열을 거기서 멈춘다. 안 그러면 합이 늘어 표 전체가 다시 비율로
      //   줄어들어 다른 열까지 움직였다(2026-11-17 실측 [127,127,616] → [196,91,583]).
      const give = Math.min(delta, m.frozen[nb] - TABLE_MIN_COL);
      widths[m.col] = m.frozen[m.col] + give;
      widths[nb] = m.frozen[nb] - give;
      const tr = state.tr;
      return writeWidths(tr, m.tablePos, table, widths) ? tr : null;
    },
    props: {
      handleDOMEvents: {
        mousedown(view: EditorView, event: MouseEvent) {
          if (!view.editable || event.button !== 0) return false;
          const rs = columnResizingPluginKey.getState(view.state) as { activeHandle: number; dragging: unknown } | undefined;
          if (!rs || rs.activeHandle < 0 || rs.dragging) return false;
          const $cell = view.state.doc.resolve(rs.activeHandle);
          const table = $cell.node(-1);
          if (!table || table.type.name !== 'table') return false;
          const tablePos = $cell.before(-1);
          const tableStart = $cell.start(-1);
          const map = TableMap.get(table);
          const col = map.colCount($cell.pos - tableStart) + (Number($cell.nodeAfter?.attrs.colspan) || 1) - 1;
          const tableDom = (view.nodeDOM(tablePos) as HTMLElement | null)?.querySelector?.('table') as HTMLTableElement | null;
          if (!tableDom) return false;
          // 지금 보이는 열 px 를 **화면에서 잰다**(첫 행 칸 폭, 병합 칸은 칸 수로 나눔) — 내용 기준(auto) 표도 비율 표도
          //   같은 길. 합 ≈ 표 폭이라 굳혀도(fixed + 그 비율) 화면은 그대로다.
          const { cols: n } = tableLayout(table);
          const measured: number[] = [];
          const firstRow = tableDom.rows[0];
          if (firstRow) {
            Array.from(firstRow.cells).forEach((c) => {
              const span = Math.max(1, c.colSpan || 1);
              const w = c.getBoundingClientRect().width / span;
              for (let j = 0; j < span; j += 1) measured.push(w);
            });
          }
          if (measured.length !== n) return false;
          const frozen = measured.map((w) => Math.max(TABLE_MIN_COL, Math.round(w)));
          const original = storedWidths(table);
          const tr = view.state.tr;
          if (writeWidths(tr, tablePos, table, frozen)) {
            tr.setMeta('addToHistory', false);   // 비율이 같아 화면이 안 변한다 — 실행 취소에 남길 것이 없다
            view.dispatch(tr);
          }
          memo = { tablePos, col, frozen, original };
          const wrapper = tableDom.closest('.tableWrapper') as HTMLElement | null;
          // 드래그 중엔 라이브러리가 열을 px 로 직접 써 표가 Δ 만큼 래퍼를 넘는다 — 스크롤바가 깜빡이지 않게 잠깐 가린다
          wrapper?.classList.add('pq-table-dragging');
          const win = view.dom.ownerDocument.defaultView || window;
          const finish = () => {
            win.removeEventListener('mouseup', finish);
            // 라이브러리 mouseup(폭 저장 → 위 appendTransaction)이 끝난 뒤 정리 — 폭이 안 바뀐 클릭이면 memo 를 버린다
            win.setTimeout(() => {
              wrapper?.classList.remove('pq-table-dragging');
              // 끌지 않고 누르기만 했다(폭 저장이 없어 memo 가 남았다) → 굳힌 폭을 원래 값으로 되돌린다.
              //   누르기만 해도 문서가 바뀌어 자동저장이 뜨던 것(Fable 비차단 지적). 실행 취소에도 안 남긴다.
              const m = memo; memo = null;
              if (!m) return;
              const t = view.state.doc.nodeAt(m.tablePos);
              if (!t || t.type.name !== 'table') return;
              const back = view.state.tr;
              if (writeWidths(back, m.tablePos, t, m.original)) { back.setMeta('addToHistory', false); view.dispatch(back); }
            }, 0);
          };
          win.addEventListener('mouseup', finish);
          return false; // 라이브러리가 이어서 드래그를 시작한다
        },
      },
    },
  });
}


/** PlanQ 표 — 편집기(PostEditor·RichEditor)와 HTML 변환(postContentHtml)이 **이것 하나**를 쓴다. */
export const PqTable = Table.extend({
  addOptions() {
    return {
      ...this.parent!(),
      resizable: true,
      renderWrapper: true,         // 보기 모드·HTML 에도 스크롤 래퍼 — 넓은 표가 잘리지 않고 그 안에서 스크롤
      lastColumnResizable: false,  // 표가 늘 본문 폭이라 마지막 경계는 뜻이 없다
      cellMinWidth: TABLE_MIN_COL,
      View: PqTableView as never,
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const { pcts, cols: n, minWidth } = tableLayout(node);
    const attrs: Record<string, unknown> = { ...this.options.HTMLAttributes, ...HTMLAttributes, style: tableStyle(minWidth, !!pcts) };
    const colEls = pcts ? pcts.map((p) => ['col', { style: `width:${p}%` }]) : Array.from({ length: n }, () => ['col', {}]);
    const table = ['table', attrs, ['colgroup', {}, ...colEls], ['tbody', 0]];
    // ★ 래퍼의 스크롤을 **인라인으로도** 싣는다 — 편집기 HTML(업무 설명·메일·지식)을 그리는 화면은 여럿이고
    //   그중 표 CSS 조각을 안 붙인 곳(공개 업무·고객 정보·지식 등)에서는 표 하한(min-width 열수×96)이 페이지를 밀었다
    //   (Fable 2026-11-04 실측: 폰 390 에서 문서 폭 1203). 화면마다 붙이는 대신 HTML 자체가 스크롤 상자를 들고 다닌다.
    return (this.options.renderWrapper
      ? ['div', { class: 'tableWrapper', style: 'overflow-x:auto;max-width:100%' }, table] : table) as never;
  },
  addProseMirrorPlugins() {
    const parent = this.parent?.() || [];
    return this.options.resizable && this.editor.isEditable ? [freezeOnResizePlugin(), ...parent] : parent;
  },
});
