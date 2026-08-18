// components/QTask/popoutPriority.ts — 팝아웃 우선순위 번호 계산 (TaskPopoutView 에서 분리)
//
// 분리한 이유: TaskPopoutView.tsx 가 컴포넌트 god-file 임계(800줄)를 넘었다.
//   번호 규칙은 순수 계산이라 렌더와 섞일 이유가 없고, 규칙 자체가 여러 번 사고를 낸 지점이라
//   한 곳에 모아 두는 편이 안전하다.

/** 팝아웃이 다루는 task 의 최소 형태 — 번호 계산에 필요한 필드만. */
export interface PriorityTaskLike {
  id: number;
  status: string;
  priority_order?: number | null;
  due_date?: string | null;
  title?: string | null;
}

/** null 을 뒤로 보내는 문자열 비교 (마감일 정렬용). */
export function cmpNullLastDate(a?: string | null, b?: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 표시용 우선순위 번호 — 메인 QTaskPage 의 displayPriorityMap 과 같은 규칙(연속 재인덱스).
 *
 * ★ 기준 집합은 **응답 tasks 전체**(완료 포함). 화면에 보이는 것만으로 잡으면 "완료 보기" 토글마다
 *   번호가 출렁이고, 완료 업무도 priority_order 를 그대로 들고 있는 메인 화면과 번호가 어긋난다.
 * ★ tie-break 를 명시한다 — DB 에 중복값(1,1,2,3,3,8)이 실재해 stable sort 의 입력 순서에 기대면
 *   서버 정렬(due asc)로 들어오는 팝아웃과 메인의 번호가 갈린다.
 * ★ 동률일 때의 순서는 메인과 **완전히 같은 사슬**이어야 한다: 완료 뒤로 → due(null last) → title → id.
 *   맨 끝 id 는 서버 services/taskPriority.js byPriorityChain 과 문자 그대로 동일한 절대 tie-break 이라
 *   위로 올리면 옛 실버그(행 순서와 칩 번호 역전)가 재발한다.
 */
export function buildPriorityMap<T extends PriorityTaskLike>(tasks: T[], closedStatuses: string[]): Map<number, number> {
  const m = new Map<number, number>();
  const doneRank = (tk: T) => (closedStatuses.includes(tk.status) ? 1 : 0);
  tasks
    .filter((tk) => tk.priority_order != null)
    .sort((a, b) => (a.priority_order! - b.priority_order!)
      || (doneRank(a) - doneRank(b))
      || cmpNullLastDate(a.due_date, b.due_date)
      || (a.title || '').localeCompare(b.title || '')
      || (a.id - b.id))
    .forEach((tk, i) => m.set(tk.id, i + 1));
  return m;
}

/**
 * 운영 #280 — "우선순위 2번이 안 나와. 1번 다음 3번이 되어버리네."
 *
 * 번호는 위 규칙상 옳다. 빠져 보이는 이유는 그 번호를 가진 업무가 지금 목록에 없기 때문이다 —
 * 완료해서 접혔거나(오늘/이번주) 다른 탭 소속.
 *
 * ★ 번호를 화면 집합으로 다시 매기면 안 된다. 보기 옵션이 번호를 바꾸면 메인 화면과 갈리고,
 *   "화면 필터로 재인덱스" 는 이 저장소가 이미 한 번 사고를 낸 패턴이다.
 *   → 번호는 그대로 두고, **왜 비었는지**를 화면이 말하게 한다.
 *
 * @returns 지금 목록에 없는 우선순위 번호들 (오름차순)
 */
export function hiddenPriorityNumbers(prioMap: Map<number, number>, visibleIds: Iterable<number>): number[] {
  const shown = new Set(visibleIds);
  return [...prioMap.entries()]
    .filter(([id]) => !shown.has(id))
    .map(([, n]) => n)
    .sort((a, b) => a - b);
}
