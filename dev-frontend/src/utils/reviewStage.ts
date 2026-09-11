// 컨펌 단계 술어 — 서버 services/reviewStage.js 와 **같은 규칙** (2026-09-11)
//
// 외부컨펌(external_review)은 단계 표시일 뿐 리스트업 조건을 바꾸지 않는다.
// 외부컨펌 직전 상태(hold_prev_status)가 컨펌 단계였으면 여전히 컨펌 단계로 본다.
// Irene: "외부컨펌 해도 … 리스트에서 안 없어지게 하고 확인필요에도 안 없어지게 하고 단계만 표시해두자."
// ★ 이번 주 목록·패널 숫자가 서버 /my-week·/dashboard/todo 와 갈라지면 번호·배지가 어긋난다 — 한쪽만 고치지 말 것.

export const REVIEW_STAGE = ['reviewing', 'revision_requested'] as const;

type StageTask = { status?: string | null; hold_prev_status?: string | null };

export function inReviewStage(t: StageTask, statuses: readonly string[] = REVIEW_STAGE): boolean {
  if (!t || !t.status) return false;
  if (statuses.includes(t.status)) return true;
  return t.status === 'external_review' && !!t.hold_prev_status && statuses.includes(t.hold_prev_status);
}
