// Q talk 고객 문의 «응대 상태 · 담당자» — 목록 술어 한 곳 (2026-11-12 · docs/QTALK_CARE_DESIGN.md).
//   «답할 문의» 세그먼트의 라벨 숫자와 걸러진 행이 **같은 함수**를 쓴다(숫자와 목록이 갈라지지 않게).
//   서버 기준과 같다 — open ∧ (담당 = 나 ∨ 미배정). 행이 없으면(문의 없음) 들지 않는다.

/** 서버가 직원에게만 싣는 응대 상태(GET /api/conversations/:biz · conversation:care). 모르는 state 는 글자 그대로 보여 준다. */
export interface ConvCare {
  state: string;
  state_changed_at?: string | null;
  assignee_user_id: number | null;
  assignee?: { id: number; name: string | null; name_localized?: Record<string, string> | null } | null;
}

export const CARE_STATES = ['open', 'hold', 'resolved'] as const;
export type KnownCareState = typeof CARE_STATES[number];
export function isKnownCareState(s: string | null | undefined): s is KnownCareState {
  return !!s && (CARE_STATES as readonly string[]).includes(s);
}

/** 내가 답할 문의인가 — 응대 중이고 담당이 나이거나 아직 아무도 안 맡았다. */
export function isMyOpenInquiry(conv: { care?: ConvCare | null }, myId: number | null | undefined): boolean {
  const c = conv.care;
  if (!c || c.state !== 'open') return false;
  if (c.assignee_user_id == null) return true;
  return myId != null && Number(c.assignee_user_id) === Number(myId);
}

/** 담당 이름 — 화면 언어의 표시명이 있으면 그것, 없으면 워크스페이스 표시명. */
export function careAssigneeName(care: ConvCare | null | undefined, lang: string): string | null {
  const a = care?.assignee;
  if (!a) return null;
  return a.name_localized?.[lang] || a.name || null;
}
