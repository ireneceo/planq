// 「무엇에 연결할 것인가」를 묻는 입력의 **문구 정본**.
//
// Irene 2026-09-18: *"모든 연결 입력 프롬프트 통일한 거 맞지?"* — 아니었다. 같은 뜻에 5가지가 돌았다:
//   「프로젝트 연결 안 함」·「프로젝트 선택 — 고객 자동 매핑 (선택)」·「프로젝트 없음」·
//   「연결 없음」·「프로젝트를 선택하세요」. 고객 쪽도 3가지(「고객 연결 안 함」·「고객 선택」·
//   「고객을 선택하세요」). 화면마다 셀렉트를 따로 세우면서 문구도 각자 적은 결과다.
//
// 축은 **둘뿐**이다:
//   · NONE — 이미 있는 것에 붙였다 뗐다 하는 자리(연결 바·상세 메타). 비어 있음 = 연결 안 됨.
//   · PICK — 새로 만들면서 고르는 자리(생성 모달). 비어 있음 = 아직 안 고름.
// 부연(고객 자동 매핑 · 워크스페이스 업무)은 **칸 밖 도움말**로 내린다 — 칸 안에 넣으면
// 값을 고르는 순간 사라지고, 고르기 전에는 문구가 길어 잘린다.
//
// ★ 새 연결 입력을 만들면 여기서 가져다 쓴다. placeholder 를 손으로 적지 않는다.
export const CONNECT_PROMPT = {
  projectNone: 'connect.projectNone',
  projectPick: 'connect.projectPick',
  clientNone: 'connect.clientNone',
  clientPick: 'connect.clientPick',
  /** 도움말 — 프로젝트를 고르면 고객이 따라온다 */
  projectHintAutoClient: 'connect.projectHintAutoClient',
  /** 도움말 — 연결 안 하면 워크스페이스 업무 */
  projectHintWorkspace: 'connect.projectHintWorkspace',
} as const;
