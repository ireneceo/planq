// 표 열 폭 맞춤 — PostEditor 에서 분리(2026-10-08, 동작 불변).
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

// 운영 #311 — "빈 문서에 표를 만들 때 좌우 길이를 모든 표를 고정할 수도 있어야 하는데
//   내용에 따라 가로 길이가 다 다르니까 정돈되지 않아 보일 때가 많아서
//   지금처럼 자유롭게도 되고 고정으로 어떤 위치를 맞출 수도 있어야지."
//
//   TipTap 의 resizable 표는 셀마다 colwidth 를 들고 다닌다. 사용자가 손으로 끌면 그 값이 제각각
//   남아 문서마다·표마다 열 폭이 어긋난다. "고정" = 그 표의 모든 열을 **같은 폭**으로 맞추는 것.
//   자유 조절은 그대로 둔다(끌면 다시 달라진다) — 둘 다 되어야 한다는 것이 요청이다.
//
//   ★ colwidth 는 **행마다** 들어 있다. 첫 행만 고치면 다른 행이 옛 폭을 들고 있어 브라우저가
//     colgroup 을 첫 행 기준으로 잡아도 저장 JSON 이 어긋난 채 남는다 → 전 행을 같이 고친다.
//   ★ colspan 이 걸린 셀은 그 칸 수만큼 곱해 준다. 안 그러면 병합된 표가 찌그러진다.
// 칸 하한 — 보기 화면(postContentView)·읽기 전용 규칙과 **같은 96px**.
//   이보다 좁게 눌러 넣으면 글이 세로로 붕괴한다.
const MIN_COL_WIDTH = 96;
// 폭을 못 재는 경우(드로어가 아직 안 떠 clientWidth 가 0)만 쓰는 대비값.
const FALLBACK_COL_WIDTH = 160;

/**
 * 표의 열을 **쓸 수 있는 폭에 맞춰 고르게** 나눈다.
 *
 * ★ 2026-09-13 (Irene: *"문서에서 표를 좌우로 맞추면 열이 잘 나눠져야 하는데 우측이
 *   빈 여백이 되어 버리는데?"*)
 *   여태 열마다 **무조건 160px** 을 넣었다. 3열 표면 480px 이라 편집 폭이 800px 일 때
 *   320px 이 오른쪽에 빈 채로 남았다 — "맞춤" 을 눌렀는데 안 맞는다.
 *   폭은 표가 들어앉은 **스크롤 래퍼(.tableWrapper)의 안쪽 폭**에서 온다.
 *   ★ 열이 많아 하한(96px)으로도 다 못 들어가면 하한으로 두고 래퍼가 가로 스크롤한다 —
 *     억지로 더 좁히면 글이 무너진다.
 *   ★ 마지막 열에 나머지 픽셀을 더해 **합이 정확히 그 폭**이 되게 한다. 안 그러면 1~3px 틈이
 *     남아 오른쪽에 실선 자국처럼 보인다.
 */
export function distributeTableColumnsEvenly(editor: Editor): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  // 커서에서 위로 올라가며 table 노드를 찾는다
  let tablePos = -1;
  let tableNode: ProseMirrorNode | null = null;
  for (let d = $from.depth; d > 0; d -= 1) {
    const n = $from.node(d);
    if (n.type.name === 'table') { tableNode = n; tablePos = $from.before(d); break; }
  }
  if (!tableNode || tablePos < 0) return false;

  // 열 수 — 첫 행의 colspan 합
  let colCount = 0;
  const firstRow = tableNode.firstChild;
  if (firstRow) firstRow.forEach((cell) => { colCount += Number(cell.attrs.colspan) || 1; });
  if (colCount <= 0) return false;

  // 쓸 수 있는 폭 — 표를 감싼 스크롤 래퍼 안쪽. 표 자신의 좌우 테두리 2px 을 뺀다
  //   (빼지 않으면 합이 폭보다 2px 커져 맞추자마자 가로 스크롤이 생긴다).
  const tableDom = editor.view.nodeDOM(tablePos) as HTMLElement | null;
  const wrapper = (tableDom && typeof tableDom.closest === 'function'
    ? (tableDom.closest('.tableWrapper') as HTMLElement | null) : null) || tableDom;
  const avail = Math.max(0, (wrapper?.clientWidth || editor.view.dom.clientWidth || 0) - 2);

  const widths: number[] = (() => {
    if (avail <= 0) return Array.from({ length: colCount }, () => FALLBACK_COL_WIDTH);
    const base = Math.floor(avail / colCount);
    if (base < MIN_COL_WIDTH) return Array.from({ length: colCount }, () => MIN_COL_WIDTH);
    const arr = Array.from({ length: colCount }, () => base);
    arr[colCount - 1] += avail - base * colCount;   // 나머지 픽셀은 마지막 열로
    return arr;
  })();

  const tr = state.tr;
  let changed = false;
  tableNode.forEach((row, rowOffset) => {
    let colIndex = 0;   // 이 행에서 지금 칸이 차지하는 첫 열 (colspan 누적)
    row.forEach((cell, cellOffset) => {
      const span = Number(cell.attrs.colspan) || 1;
      const next = Array.from({ length: span }, (_, i) =>
        widths[Math.min(colIndex + i, widths.length - 1)]);
      colIndex += span;
      const cur = cell.attrs.colwidth as number[] | null;
      if (cur && cur.length === span && cur.every((w, i) => w === next[i])) return;
      // +1: table -> row 진입, +1: row -> cell 진입
      const cellPos = tablePos + 1 + rowOffset + 1 + cellOffset;
      tr.setNodeMarkup(cellPos, undefined, { ...cell.attrs, colwidth: next });
      changed = true;
    });
  });
  if (!changed) return false;
  editor.view.dispatch(tr);
  return true;
}
