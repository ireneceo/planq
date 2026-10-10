// 고객 프로젝트 링크 개요의 **업무 통계** — 순수 함수 한 곳 (docs/GUEST_PROJECT_VIEW_DECISIONS.md §I-1).
//
// 입력은 이미 무인증으로 여는 `/api/guest/:token/tasks` 목록뿐이다 — 서버 필드를 늘리지 않는다.
// ★ 진행률(완료/전체)은 여기서 내지 않는다 — 서버 `task_summary` 하나가 정본이다(두 번째 공식 금지).
//   여기서 세는 것은 다른 값(상태별 건수·지연·이번 주 마감·최근 완료·주별 완료 추이)이다.
// ★ 담당자별 건수는 만들지 않는다 — 숨김 정책이면 뜻이 없고, 표시 정책이면 직원별 업무량이 나간다.
// ★ 모르는 상태는 «기타» 로 **보이게** 센다(상태값 규약 — 조용히 다른 칸에 떨어뜨리지 않는다).
//   버킷 합 == 입력 길이 가 불변식이다.
// 로그인 고객 앱 화면에 개요가 생기면 이 파일을 그대로 쓴다(§I-6).

export type StatTask = {
  id: number; title: string; status: string;
  due_date: string | null; completed_at: string | null;
  is_milestone?: boolean; assignee_name?: string | null;
};

export type StatusBucket = 'waiting' | 'active' | 'review' | 'done' | 'canceled' | 'other';
export const STATUS_BUCKETS: StatusBucket[] = ['waiting', 'active', 'review', 'done', 'canceled', 'other'];
const BUCKET_OF: Record<string, StatusBucket> = {
  not_started: 'waiting', waiting: 'waiting', on_hold: 'waiting',
  in_progress: 'active', external_review: 'active',
  reviewing: 'review', revision_requested: 'review', done_feedback: 'review',
  completed: 'done',
  canceled: 'canceled',
};
export const bucketOf = (status: string): StatusBucket => BUCKET_OF[status] || 'other';
const CLOSED = new Set(['completed', 'canceled']);

/** 날짜 값의 YYYY-MM-DD — 서버는 DATEONLY 를 `…T00:00:00.000Z` 로 준다(앞 10자리가 그 날짜). */
const ymd = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '');
/** 보는 사람 로컬 날짜의 YYYY-MM-DD. */
export const localYmd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/** 그 날이 든 주의 월요일(로컬). */
const mondayOf = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

export type TaskStats = {
  total: number;
  buckets: Record<StatusBucket, number>;
  overdue: StatTask[];
  overdueCount: number;
  dueThisWeek: StatTask[];
  dueThisWeekCount: number;
  recentDone: StatTask[];
  /** 오래된 주 → 최근 주 8개. weekStart 는 월요일 YYYY-MM-DD */
  weekly: { weekStart: string; count: number }[];
  /** 완료(completed_at 있음) 수 — 추이 막대의 합과 같다 */
  doneWithDate: number;
  /** 목록이 상한(200)에 걸려 서버 전체보다 적다 — 화면이 «최근 200건 기준» 을 말한다 */
  capped: boolean;
};

export function computeTaskStats(tasks: StatTask[], opts: { now?: Date; serverTotal?: number; listCap?: number } = {}): TaskStats {
  const now = opts.now || new Date();
  const today = localYmd(now);
  const weekEnd = localYmd(addDays(now, 7));
  const buckets = { waiting: 0, active: 0, review: 0, done: 0, canceled: 0, other: 0 } as Record<StatusBucket, number>;
  const overdue: StatTask[] = [];
  const dueThisWeek: StatTask[] = [];
  for (const k of tasks) {
    buckets[bucketOf(k.status)] += 1;
    const due = ymd(k.due_date);
    if (!due || CLOSED.has(k.status)) continue;
    if (due < today) overdue.push(k);
    else if (due < weekEnd) dueThisWeek.push(k);
  }
  overdue.sort((a, b) => ymd(a.due_date).localeCompare(ymd(b.due_date)));
  dueThisWeek.sort((a, b) => ymd(a.due_date).localeCompare(ymd(b.due_date)));

  const done = tasks.filter((k) => k.status === 'completed' && k.completed_at);
  const recentDone = [...done].sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at))).slice(0, 5);

  const thisMon = mondayOf(now);
  const weekly = Array.from({ length: 8 }, (_, i) => ({ weekStart: localYmd(addDays(thisMon, -7 * (7 - i))), count: 0 }));
  const firstMon = weekly[0].weekStart;
  for (const k of done) {
    const d = new Date(String(k.completed_at));
    if (Number.isNaN(d.getTime())) continue;
    const ws = localYmd(mondayOf(d));
    if (ws < firstMon) continue;
    const slot = weekly.find((w) => w.weekStart === ws);
    if (slot) slot.count += 1;
  }

  const cap = opts.listCap ?? 200;
  return {
    total: tasks.length,
    buckets,
    overdue: overdue.slice(0, 5), overdueCount: overdue.length,
    dueThisWeek: dueThisWeek.slice(0, 5), dueThisWeekCount: dueThisWeek.length,
    recentDone,
    weekly,
    doneWithDate: weekly.reduce((s, w) => s + w.count, 0),
    capped: tasks.length >= cap && (opts.serverTotal ?? 0) > tasks.length,
  };
}
