// "오늘 내 업무" 판정 — Q Task 본 화면과 팝아웃이 **공유하는 단일 술어**.
//
// 운영 #237 "오늘 나의 업무 탭을 Q task에 추가… 이번 주 나의 업무와 같은 맥락에서 오늘 기준이 되는 일만"
// 운영 #258 "오늘 내 업무에는 오늘이 낀거랑 지연된 것만 보여주는 거고"
//
// ★ 오늘 집합은 **이번 주 정본 집합의 부분집합**이다 (오늘 ⊆ 이번 주).
//   주간 판정(inWeekCanonical / 백엔드 myWeekWhere)을 복사해 세 번째 미러를 만들면 안 된다 —
//   이미 백엔드 정본 ↔ 프론트 미러 2벌이고, 한쪽만 고쳐 화면 간 우선순위 번호가 갈린 사고가 있었다.
//   여기서는 주간 판정 위에 얹는 **날짜/상태 필터**만 정의한다.
//
// ★ 그래프·가용시간·업무시간은 **주간 기준 유지**가 Irene 의 명시 요구다 — 이 술어는 리스트에만 쓴다.
//
// ★ 2026-11-14 — **미확인 받은 요청은 날짜 무관 오늘의 일이다** (Irene: «업무요청 들어온 건 바로 오늘 업무리스트에도
//   나오게 … 확인필요에 들어오는 거고, 오늘 업무로 가정해서 확인은 먼저 하게» · Fable 설계 GO-WITH-CHANGES).
//   술어는 확인필요 ① 버킷(dev-backend routes/dashboard.js unconfirmed · services/urgentTaskNotify.isUnackedRequest)과
//   **같은 선**이다 — 한쪽만 바꾸지 말 것. 확인(ack)하면 빠지고 그 뒤는 아래 날짜 규칙을 탄다.
//   이번 주 쪽은 목록(백엔드 weekTaskSet.myWeekWhere · QTaskPage inWeekCanonical)만 넓힌다 — 그래프·가용시간·주간보고는 불변.

export interface TodayTaskLike {
  status: string;
  due_date?: string | null;
  start_date?: string | null;
  completed_at?: string | null;
  assignee_id?: number | null;
  reviewers?: Array<{ user_id: number; state: 'pending' | 'approved' | 'revision' }> | null;
  request_by_user_id?: number | null;
  request_ack_at?: string | null;
}

/** 확인필요 ① 과 같은 상태 집합 (백엔드 services/urgentTaskNotify.UNACKED_STATUSES). 보류·제출 뒤 단계는 «요청 확인» 이 아니다. */
export const UNACKED_REQUEST_STATUSES = ['not_started', 'waiting', 'in_progress'];

/** 나에게 온, 아직 확인하지 않은 업무요청인가 — 확인필요 ① 버킷과 같은 술어. */
export function isUnackedRequestToMe(t: TodayTaskLike, myId: number): boolean {
  if (!myId || t.assignee_id !== myId) return false;
  if (t.request_by_user_id == null || t.request_by_user_id === myId) return false;
  if (t.request_ack_at) return false;
  return UNACKED_REQUEST_STATUSES.includes(t.status);
}

/** «미래 전용» 업무인가 — 그 주(periodFrom~periodTo)에 계획되지 않았고, 날짜가 전부 그 주 끝 뒤.
 *  미래 전용 = planned_week_start ≠ periodFrom ∧ (start_date > periodTo ∨ (start_date 없음 ∧ due_date > periodTo)).
 *  ★ 2026-11-17 (Irene «1월 달건데 리스트에 다 나와» · Fable decision B) — 미확인 요청·waiting(진행대기) 두 갈래가
 *  이번 주 목록에 날짜 무관으로 들어가 1월 업무가 매주 떴다. 두 갈래만 이 함수로 거른다.
 *  백엔드 미러 `services/weekTaskSet.notFutureOnly` — 한쪽만 바꾸지 말 것. */
export function isFutureOnly(
  t: { start_date?: string | null; due_date?: string | null; planned_week_start?: string | null },
  periodFrom: string, periodTo: string,
): boolean {
  if ((t.planned_week_start || '').slice(0, 10) === periodFrom) return false;
  const start = (t.start_date || '').slice(0, 10);
  if (start) return start > periodTo;
  const due = (t.due_date || '').slice(0, 10);
  return !!due && due > periodTo;
}

/** 완료 시각을 **워크스페이스 로컬 날짜**로. `slice(0,10)` 금지 —
 *  completed_at 은 UTC ISO 라, KST 오전 9시 이전 완료가 전날로 오판된다.
 *  주 단위에서는 주 경계에서만 드러나던 결함이 "오늘" 단위에선 매일 드러난다. */
export function completedDateLocal(completedAt: string | null | undefined, tz: string): string {
  if (!completedAt) return '';
  const d = new Date(completedAt);
  if (Number.isNaN(d.getTime())) return '';
  try {
    // en-CA 로케일이 YYYY-MM-DD 를 준다 (utils/timezones.dateStrInTz 와 같은 방식)
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * 오늘 해야 하는 일인가. (호출측이 먼저 주간 정본 판정을 통과시킨 뒤 이 필터를 적용한다.)
 *
 * @param t         업무
 * @param today     'YYYY-MM-DD' — 워크스페이스 기준 오늘
 * @param myId      나
 * @param tz        워크스페이스 타임존 (완료 판정용)
 * @param includeDone 오늘 완료한 업무를 포함할지 (완료 섹션용)
 */
export function inTodaySet(t: TodayTaskLike, today: string, myId: number, tz: string, includeDone: boolean): boolean {
  const isDone = t.status === 'completed' || t.status === 'canceled';
  if (isDone) {
    // ⑧ 오늘 완료한 것 — Cue 로 "완료로 추가" 한 업무도 completed_at=지금 이라 여기 안착한다.
    if (!includeDone) return false;
    return completedDateLocal(t.completed_at, tz) === today;
  }

  // ⓪ 미확인 받은 요청 — 날짜와 무관하게 오늘 먼저 확인할 일이다 (2026-11-14, 위 머리말)
  if (isUnackedRequestToMe(t, myId)) return true;

  const due = (t.due_date || '').slice(0, 10);     // 날짜 컬럼은 DATE 라 UTC 이슈 없음
  const start = (t.start_date || '').slice(0, 10);

  // ⑦ 내가 지금 해야 하는 컨펌 — 날짜와 무관하게 오늘의 액션이다
  const myRev = (t.reviewers || []).find(rv => rv.user_id === myId);
  if (myRev && myRev.state === 'pending' && (t.status === 'reviewing' || t.status === 'revision_requested')) return true;

  // ① 지연 (마감이 지났는데 안 끝남) — Irene "지연된 것"
  if (due && due < today) return true;
  // ② 오늘 마감
  if (due && due === today) return true;
  // ③ 기간이 오늘을 낌 — Irene "오늘이 낀 거"
  if (start && due && start <= today && today <= due) return true;
  // ④ 시작일이 지난(오늘 포함) 마감 없는 일 — 주간 집합이 «이번 주 시작» 만 들여오므로 flood 없음 (2026-10-29)
  if (start && !due && start <= today) return true;
  // ⑤ 날짜가 없어도 지금 손에 잡고 있는 일은 오늘의 일이다
  if (!due && !start && (t.status === 'in_progress' || t.status === 'revision_requested')) return true;

  // ⑥ reviewing·waiting·external_review 이면서 위 날짜 조건을 못 넘긴 것은 제외 —
  //    내 손을 떠나 남을 기다리는 중이라 오늘의 액션이 아니다.
  return false;
}
