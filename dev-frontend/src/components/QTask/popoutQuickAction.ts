// 팝아웃 행 퀵액션 판정 — 순수 함수. TaskPopoutView 가 800줄 한도에 닿아 절출했다(god-file 래칫).
//   화면이 아니라 **규칙**이라 파일이 갈리는 편이 읽기도 쉽다.
// 행 퀵액션 분기 — Fable 설계 확정본(2026-07-28)의 5분기. **raw status 로만 판정**한다
// (displayStatus 는 '지연' 같은 표시용 코드를 섞기 때문에 여기 쓰면 안 된다).
//
//   canceled            → 인터랙션 없음 (☐ 를 주면 취소된 업무가 완료로 뒤집힌다)
//   completed  rc===0   → ☑ 클릭 시 /revert-status 로 직전 복귀
//   completed  rc>=1    → ☑ 고정. 컨펌 승인으로 완료된 건을 여기서 되돌리면 마지막 history 가
//                          review_submit 이라 reviewing 이 아니라 in_progress 로 떨어지고,
//                          reviewer state 는 'approved' 로 남아 이력과 모순된다.
//   reviewing           → 표시만. submit-review 재호출은 새 라운드를 열어 받아둔 승인을 리셋한다.
//   rc===0 그 외        → ☐ 클릭 시 /complete
//   rc>=1  in_progress·revision_requested → ↻ /submit-review, 나머지는 퀵액션 없음
export type QuickAction =
  | 'complete' | 'uncheck' | 'submit' | 'checked_locked' | 'reviewing' | 'none';

// isAssignee=false 는 **무조건 퀵액션 없음**. my-week 집합이 "내가 pending 컨펌자인 남의 업무" 와
//   "내가 관여한 이번 주 완료" 까지 포함하도록 넓어졌으므로(메인 weekSet 미러), 담당자 전제인 5분기를
//   그대로 적용하면 남의 revision_requested 에 ↻ 가 떠서 클릭 시 403 only_assignee 가 난다.
//   컨펌 액션은 행 클릭 → TaskDetailDrawer 가 이미 담당한다.
export function quickActionFor(status: string, reviewerCount: number, isAssignee: boolean): QuickAction {
  if (!isAssignee) return 'none';
  if (status === 'canceled') return 'none';
  if (status === 'completed') return reviewerCount === 0 ? 'uncheck' : 'checked_locked';
  if (status === 'reviewing') return 'reviewing';
  if (reviewerCount === 0) return 'complete';
  if (status === 'in_progress' || status === 'revision_requested') return 'submit';
  return 'none';
}
