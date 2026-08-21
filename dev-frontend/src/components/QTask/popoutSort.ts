// 팝아웃 목록의 순수 헬퍼 — 정렬 규칙 + 퀵애드 선택지.
//   TaskPopoutView 가 god-file 임계(800줄)를 넘어 절출했다. 상태를 안 쥐는 순수 함수만 모은다
//   (PopoutQuickAdd·PopoutViewChips 를 절출한 것과 같은 이유·같은 방식).

/** 정렬·선택지 계산에 필요한 최소 형태만 받는다 — 이 파일이 PopoutTask 전체를 알 필요는 없다. */
export interface SortableTask {
  title?: string;
  due_date?: string | null;
  priority_order?: number | null;
}
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

// 메인 QTaskPage 기본 정렬과 동일: priority_order(null last) → due_date(null last) → title
export function bySortRule(a: SortableTask, b: SortableTask): number {
  const pa = a.priority_order ?? null;
  const pb = b.priority_order ?? null;
  if (pa !== pb) {
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  }
  const d = cmpNullLast(a.due_date, b.due_date);
  if (d !== 0) return d;
  return (a.title || '').localeCompare(b.title || '');
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
