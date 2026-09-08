// canary-popout-sort — 팝아웃 업무 목록의 정렬 셀렉트 (2026-09-08)
//
//   Irene: "오늘 내 업무랑 이번주 업무 팝아웃에서 업무리스트 소팅 기능이 없어. 기존 Q task 상단에
//          항목을 누르면 소팅이 되거든. 팝아웃에서는 셀렉트항목으로 소팅하게 해줄래?
//          최신등록순, 이름순, 업무단계순, 이렇게 넣고 기본은 최신등록순으로 하고
//          태그별, 프로젝트별로 표시될 때는 그 소항목 아래에서 이 순서로 나오게 해줘."
//
//   ★ 핵심 계약은 **그룹은 그대로 두고 그 안쪽만 정렬**이라는 것이다.
//     그룹 헤더가 뒤섞이면 "태그별 보기" 가 깨진 것이고, 안쪽이 안 바뀌면 죽은 컨트롤이다.
//     둘 다 재야 한다 — 한쪽만 재면 통과시키고 놓친다.
const { bySelectedSort, POPOUT_SORT_KEYS } = require('/opt/planq/dev-frontend/src/components/QTask/popoutSort.ts');

async function run() {
  return [];
}
module.exports = { run };
