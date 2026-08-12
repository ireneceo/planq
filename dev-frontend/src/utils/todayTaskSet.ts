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

export interface TodayTaskLike {
  status: string;
  due_date?: string | null;
  start_date?: string | null;
  completed_at?: string | null;
  assignee_id?: number | null;
  reviewers?: Array<{ user_id: number; state: 'pending' | 'approved' | 'revision' }> | null;
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
  // ④ 오늘 시작 (마감 없음)
  if (start && !due && start === today) return true;
  // ⑤ 날짜가 없어도 지금 손에 잡고 있는 일은 오늘의 일이다
  if (!due && !start && (t.status === 'in_progress' || t.status === 'revision_requested')) return true;

  // ⑥ reviewing·waiting·external_review 이면서 위 날짜 조건을 못 넘긴 것은 제외 —
  //    내 손을 떠나 남을 기다리는 중이라 오늘의 액션이 아니다.
  return false;
}
