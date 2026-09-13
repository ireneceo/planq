// postContentView — **HTML 로 그리는 문서 본문**의 표 규격 한 벌.
//
// ★ 2026-09-13 (Irene: *"문서를 만들었는데 표가 오른쪽이 잘려. 왜그러지?"*)
//
//   문서 본문은 두 가지 방식으로 그려진다:
//     ① `PostEditor editable={false}` — TipTap. 여기엔 2026-08-27 에 넣은 읽기 전용 표 규칙이 있다
//        (`table { display:block; overflow-x:auto }`). 잘리지 않는다.
//     ② `postContentToSafeHtml()` + `dangerouslySetInnerHTML` — **게스트 문서 보기**와
//        **프로젝트 문서 미리보기**. 여기는 각자 `table{width:100%}` 한 줄뿐이라,
//        칸이 많은 표가 컨테이너 폭 안으로 눌려 글자가 잘렸다.
//
//   ①의 규칙이 ②에 자동으로 갈 거라고 **가정한 것**이 원인이다. 스타일이 컴포넌트 안에 갇혀 있었다.
//   그래서 ②가 쓸 조각을 여기 하나 두고, HTML 을 넣는 곳은 전부 이것을 붙인다.
//   새 화면이 생겨도 이 조각만 붙이면 된다 — 각자 table CSS 를 다시 쓰면 또 갈라진다
//   (memory `feedback_copied_component_drifts_extract_shell`).
import { css } from 'styled-components';

export const postContentTableCss = css`
  /* 변환기(utils/postContentHtml)가 표를 .tableWrapper 로 감싼다 — 편집기와 **같은 클래스 이름**이다 */
  .tableWrapper {
    margin: 16px 0;
    max-width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    &::-webkit-scrollbar { height: 8px; }
    &::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 4px; }
  }
  table {
    border-collapse: collapse;
    /* 칸이 많으면 자연폭을 가지고 래퍼 안에서 가로 스크롤한다 — 눌러 넣지 않는다 */
    width: auto;
    min-width: 100%;
    table-layout: auto;
    font-size: 0.8125rem;
  }
  /* 칸 하한은 편집 화면과 같은 96px — 이보다 좁게 눌러 넣으면 글이 세로로 붕괴한다 */
  td, th {
    border: 1px solid #E2E8F0;
    padding: 8px 10px;
    min-width: 96px;
    word-break: break-word;
    overflow-wrap: anywhere;
    vertical-align: top;
  }
  th { background: #F8FAFC; font-weight: 700; text-align: left; }
`;
