// 팝아웃 목록의 순수 헬퍼 — 정렬 규칙 + 퀵애드 선택지.
//   TaskPopoutView 가 god-file 임계(800줄)를 넘어 절출했다. 상태를 안 쥐는 순수 함수만 모은다
//   (PopoutQuickAdd·PopoutViewChips 를 절출한 것과 같은 이유·같은 방식).

/** 정렬·선택지 계산에 필요한 최소 형태만 받는다 — 이 파일이 PopoutTask 전체를 알 필요는 없다. */
export interface SortableTask {
  id?: number;
  title?: string;
  due_date?: string | null;
  priority_order?: number | null;
  status?: string;
}
// 완료·취소는 읽을 순서의 끝이다. 정본(services/taskPriority.js CLOSED)과 같은 집합.
const CLOSED_STATUSES = ['completed', 'canceled'];
export interface ChoiceSourceTask {
  tags?: Array<{ id: number; name: string }> | null;
  Project?: { id: number; name: string } | null;
}

// null 은 항상 뒤로. (서버 order 의 `due_date ASC` 는 MySQL NULL-first 라 마감 없는 업무가 맨 위로 온다 —
//  메인 QTaskPage 는 null-last 라서 두 화면의 순서가 갈렸다. 여기서 메인 규칙으로 맞춘다.)
export function cmpNullLast(a?: string | null, b?: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// ★ 정본 tie-break 사슬 — `dev-backend/services/taskPriority.js` 의 byPriorityChain 과
//   **문자 그대로 같아야 한다.** 그 파일 주석이 "프론트 두 비교자와 문자 그대로 같아야 한다" 고
//   못박아 뒀는데, 이 팝아웃 비교자만 세 군데가 어긋나 있었다
//   (Irene 2026-08-28: "팝아웃에 이번주 업무 우선순위랑 Q task 우선순위가 안맞아"):
//     ① priority_order 의 null 처리가 **반대**였다 — 정본은 `|| 0`(null=0 → 앞), 여기는 null-last
//     ② **완료/취소를 뒤로 보내는 단계가 통째로 없었다** — 팝아웃에선 완료가 사이사이에 끼었다
//     ③ **맨 끝 id tie-break 이 없었다** — 완전 동률일 때 순서가 비결정적이라 볼 때마다 달라진다
//
//   순서: priority(asc, null=0) → 완료 뒤로 → 마감(null last) → 제목 → id(맨 끝)
//   ★ id 를 앞으로 올리지 말 것 — 이 저장소가 "옛 실버그" 로 박제한 패턴이다.
export function bySortRule(a: SortableTask, b: SortableTask): number {
  const p = (a.priority_order || 0) - (b.priority_order || 0);
  if (p !== 0) return p;
  const doneRank = (t: SortableTask) => (t.status && CLOSED_STATUSES.includes(t.status) ? 1 : 0);
  const d = doneRank(a) - doneRank(b);
  if (d !== 0) return d;
  const due = cmpNullLast(a.due_date, b.due_date);
  if (due !== 0) return due;
  const title = (a.title || '').localeCompare(b.title || '');
  if (title !== 0) return title;
  return (a.id || 0) - (b.id || 0);   // ★ 맨 끝 절대 tie-break
}

// #309 — 지금 보고 있는 기준에 맞는 퀵애드 선택지.
//   · 태그별   → 지금 목록에 등장하는 태그
//   · 프로젝트별 → 지금 목록에 등장하는 프로젝트
//   · 그 외(마감별) → 날짜는 탭이 이미 정한다(오늘 탭=오늘 / 이번 주 탭=그 주) → 선택지 없음
//   목록에 없는 것을 고르게 하면 추가하자마자 화면에서 사라진다(게이트 불일치). 그래서 등장한 것만 준다.
export function buildQuickChoices(view: string, tasks: ChoiceSourceTask[]): Array<{ value: string; label: string }> {
  const m = new Map<string, string>();
  if (view === 'tag') {
    tasks.forEach((tk) => (tk.tags || []).forEach((tg) => m.set(String(tg.id), tg.name)));
  } else if (view === 'project') {
    tasks.forEach((tk) => { if (tk.Project) m.set(String(tk.Project.id), tk.Project.name); });
  } else {
    return [];
  }
  return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}
