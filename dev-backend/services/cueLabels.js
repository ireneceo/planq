// services/cueLabels.js — LLM 컨텍스트에 싣는 **상태값의 사람 말 라벨** 단일 원천
//
// 왜 필요한가 (2026-09-03, Fable 판정):
//   Cue 답변에 DB ENUM 이 그대로 실려 나갔다 —
//     "• 김도윤 · 하나커피 (invited)  • 박서연 · 미래건설 (invited)"
//   `invited` 는 우리 컬럼값이지 사용자의 말이 아니다(memory feedback_user_facing_copy).
//   ★ 더 나쁜 것: `composeMarkdown` 은 고객 대화방 답변(respondToMessage)도 쓴다.
//     즉 raw ENUM 이 **이미 고객에게 나가고 있었다.**
//
//   왜 프롬프트 규칙("raw 값을 쓰지 말라")이 아니라 여기인가:
//     LLM 규칙은 확률적이고 언어마다 흔들린다 — 같은 상태가 답마다 "초대됨/초대 중/invited"
//     로 갈린다. 반면 **raw 값을 내보내는 자리는 결정론적으로 열거된다.** 주는 쪽을 고친다.
//     (cueMenus 와 같은 처방: LLM 은 우리가 준 텍스트를 그대로 믿는다.)
//
//   왜 프론트 i18n 을 런타임에 읽지 않는가:
//     운영은 백엔드(/opt/planq/backend)와 프론트 빌드(frontend-build/locales/*.json)가 갈라져
//     배포된다. 게다가 업무 라벨은 `status.<code>.<관점>` 4차원이고 화면에는 가상 상태
//     (task_requested 등)까지 있어 컨텍스트가 가진 필드로는 재현이 안 된다.
//     그래서 정본은 백엔드 한 벌로 두고, **같은 말인지는 가드가 대조한다**:
//       node scripts/guard-invariants.js --category=statuslabel
//
//   Cue 는 당사자가 아니라 **관찰자**다 → 업무 라벨은 i18n 의 `observer` 관점을 쓴다.
//   컨텍스트 마크다운 자체가 한국어 고정이라 ko 만 싣는다(영어 답은 LLM 이 옮긴다).

const LABELS = {
  // clients.json status.*
  client: {
    active: '활성',
    invited: '초대됨',
    archived: '비활성',
  },
  // clients.json projectStatus.*
  project: {
    active: '진행',
    paused: '일시중지',
    completed: '완료',
  },
  // qtask.json status.<code>.observer — **화면 문구 그대로**.
  //   ★ 처음 이 파일을 쓸 때 나는 화면의 다른 키(timeline.taskStatus.*)를 베껴
  //     '시작 전 / 대기 / 확인 요청 / 수정 요청 / 보류' 로 적었다. 가드가 5건을 잡았다.
  //     눈으로는 "비슷하니 같은 말" 로 보이지만, 사용자가 화면에서 읽는 단어와 Cue 가
  //     말하는 단어가 다르면 같은 것을 가리키는지 알 수 없다.
  task: {
    not_started: '미진행',
    task_requested: '업무요청',
    waiting: '진행대기',
    in_progress: '진행중',
    reviewing: '확인진행중',
    revision_requested: '수정요청',
    done_feedback: '마무리 대기',
    completed: '완료',
    canceled: '취소',
    on_hold: '보류중',
    external_review: '외부컨펌중',
  },
  // qbill.json invoices.status.*
  invoice: {
    draft: '작성중',
    sent: '발송됨',
    partially_paid: '일부 결제',
    paid: '결제완료',
    overdue: '연체',
    canceled: '취소',
  },
  // clientTimeline 항목 종류 — 고객 히스토리 타임라인 (chat/email/invoice/task)
  //   ★ 가드가 넓힌 뒤에 잡혔다: `${it.type || it.kind || '활동'}` 로 내부값이 그대로 실렸다.
  timelineKind: {
    chat: '대화',
    email: '메일',
    invoice: '청구',
    task: '업무',
  },
  // cue_knowledge.kind — 팀이 확정한 지식 카드 종류 (Fable 권고 2026-09-03)
  knowledgeKind: {
    work_pattern: '업무 방식',
    client_trait: '고객 특성',
    terminology: '용어',
    decision: '결정 사항',
    custom: '기타',
  },
  // project_stages.kind — 거래 단계 종류
  stageKind: {
    quote: '견적',
    proposal: '제안',
    contract: '계약',
    invoice: '청구',
    tax_invoice: '세금계산서',
    custom: '사용자 정의',
  },
};

/**
 * 상태 코드를 사람 말로. 모르는 코드는 **raw 그대로 돌려준다.**
 *   ★ 빈 문자열이나 기본값으로 떨어뜨리지 않는다 — 새 상태값이 생겼을 때
 *     화면에서 조용히 사라지면 그게 곧 다음 사고다
 *     (memory feedback_unknown_state_silent_default: "안 열린다" 로 보인다).
 *     낯선 값이 그대로 보이면 최소한 눈에 띈다.
 */
function label(kind, code) {
  if (code === null || code === undefined || code === '') return '-';
  const map = LABELS[kind];
  if (!map) return String(code);
  return map[String(code)] || String(code);
}

module.exports = { LABELS, label };
