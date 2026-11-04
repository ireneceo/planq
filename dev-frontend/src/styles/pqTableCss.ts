// 문서 표 CSS 한 벌 (2026-11-04) — 편집기(PostEditor·RichEditor) · HTML 보기(게스트·미리보기·공개 문서)가 **같은 조각**을 붙인다.
//   전에는 세 벌(PostEditor Body · RichEditor · postContentView)이 각자 width·layout 을 적어
//   «편집은 내용 폭 + 스크롤 / 보기는 100% 로 눌림 또는 잘림 / HTML 은 auto» 로 갈라졌다.
//
// 기준(설계 components/Docs/pqTable.ts 머리말 — Fable 판정 A):
//   · 표 = 본문 폭 100% · 열 = 저장 폭의 **비율**(%) — 둘 다 표 확장이 인라인으로 싣는다(width:100% · min-width:열수×96px).
//   · 열 수 × 96 > 본문 폭 이면 .tableWrapper 안에서만 가로 스크롤 — 페이지 밖으로 잘리지 않는다.
//   · 우리 표는 table-layout:fixed(인라인) 라 열이 글 길이로 늘지 않는다 — 대신 안 끊기는 긴 글(주소)은 칸 안에서 줄을 바꾼다.
//   ★ 여기에 width:max-content · display:block · :has(col:nth-child(N)) 같은 화면별 덮어쓰기를 다시 넣지 않는다 —
//     그 셋이 이번에 갈라진 원인이었다(9열 임계값은 데스크탑 872px 에서만 맞던 값).
//   ★ 인라인 min-width 가 없는 옛 HTML(공개 문서 옛 스냅샷)도 안 잘리게 표 자체 하한은 CSS 로도 둔다(min-width:100%).
//   ★ styled 템플릿 안 주석에 백틱 금지(템플릿이 끊긴다).
import { css } from 'styled-components';

export const pqTableCss = css`
  .tableWrapper {
    margin: 16px 0;
    max-width: 100%;
    overflow-x: auto;
    &::-webkit-scrollbar { height: 8px; }
    &::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 4px; }
  }
  .tableWrapper.pq-table-dragging { overflow-x: hidden; }
  .tableWrapper > table { margin: 0; }
  table {
    border-collapse: separate; border-spacing: 0;
    /* 우리 표는 확장이 인라인 table-layout:fixed 를 싣는다. 열 정보 없는 표(마크다운·외부 HTML)는 내용 기준 + 칸 하한 96 */
    table-layout: auto;
    width: 100%;
    min-width: 100%;
    max-width: none;
    font-size: 0.8125rem; margin: 16px 0;
    border: 1px solid #CBD5E1; border-radius: 10px;
    overflow: hidden;
    background: #fff;
  }
  td, th {
    border-right: 1px solid #E2E8F0;
    border-bottom: 1px solid #E2E8F0;
    padding: 10px 14px;
    vertical-align: top; min-width: 96px;
    position: relative; box-sizing: border-box;
    word-break: break-word; overflow-wrap: anywhere;
  }
  td a[href], th a[href] { overflow-wrap: anywhere; word-break: break-all; }
  td:last-child, th:last-child { border-right: none; }
  tr:last-child td, tr:last-child th { border-bottom: none; }
  th {
    background: #F8FAFC; color: #0F172A; font-weight: 700;
    text-align: left; letter-spacing: -0.1px;
    border-bottom: 1px solid #CBD5E1;
  }
  /* 둥근 모서리 — table 에만 주면 칸 배경이 모서리를 덮는다 */
  tr:first-child th:first-child, tr:first-child td:first-child { border-top-left-radius: 10px; }
  tr:first-child th:last-child, tr:first-child td:last-child { border-top-right-radius: 10px; }
  tr:last-child td:first-child, tr:last-child th:first-child { border-bottom-left-radius: 10px; }
  tr:last-child td:last-child, tr:last-child th:last-child { border-bottom-right-radius: 10px; }
  table p { margin: 0; }
`;
