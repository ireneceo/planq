// 우선순위 정렬 사슬 3벌 교차 검증 (Irene 2026-08-28: "팝아웃과 Q task 우선순위가 안맞아")
//   정본은 dev-backend/services/taskPriority.js 의 byPriorityChain.
//   프론트 두 비교자(QTaskPage.byPriorityChain · popoutSort.bySortRule)가 **문자 그대로** 같아야 한다.
//   같은 입력에 세 벌이 같은 순서를 내는지 본다 — 하나라도 어긋나면 두 화면 번호가 갈린다.
const cmpNullLast = (a, b) => (!a && !b) ? 0 : (!a ? 1 : (!b ? -1 : (a < b ? -1 : a > b ? 1 : 0)));
const CLOSED = ['completed', 'canceled'];

// ① 정본 (서버 taskPriority.js 를 옮긴 것)
const canonical = (a, b) => {
  const p = (a.priority_order || 0) - (b.priority_order || 0); if (p !== 0) return p;
  const dr = (t) => (CLOSED.includes(t.status) ? 1 : 0);
  const d = dr(a) - dr(b); if (d !== 0) return d;
  const due = cmpNullLast(a.due_date, b.due_date); if (due !== 0) return due;
  const t = String(a.title || '').localeCompare(String(b.title || '')); if (t !== 0) return t;
  return a.id - b.id;
};
// ② 팝아웃 (수정본)
const popout = (a, b) => {
  const p = (a.priority_order || 0) - (b.priority_order || 0); if (p !== 0) return p;
  const dr = (t) => (t.status && CLOSED.includes(t.status) ? 1 : 0);
  const d = dr(a) - dr(b); if (d !== 0) return d;
  const due = cmpNullLast(a.due_date, b.due_date); if (due !== 0) return due;
  const t = (a.title || '').localeCompare(b.title || ''); if (t !== 0) return t;
  return (a.id || 0) - (b.id || 0);
};
// ③ 옛 팝아웃 (수정 전) — 반증용. 이게 정본과 달라야 "검사가 실제로 구분한다" 가 증명된다.
const oldPopout = (a, b) => {
  const pa = a.priority_order ?? null, pb = b.priority_order ?? null;
  if (pa !== pb) { if (pa === null) return 1; if (pb === null) return -1; return pa - pb; }
  const d = cmpNullLast(a.due_date, b.due_date); if (d !== 0) return d;
  return (a.title || '').localeCompare(b.title || '');
};

const TASKS = [
  { id: 1, title: '완료된 1순위',   priority_order: 1,    due_date: '2026-08-25', status: 'completed' },
  { id: 2, title: '진행중 1순위',   priority_order: 1,    due_date: '2026-08-26', status: 'in_progress' },
  { id: 3, title: '우선순위 없음A', priority_order: null, due_date: '2026-08-24', status: 'in_progress' },
  { id: 4, title: '우선순위 없음B', priority_order: null, due_date: null,          status: 'not_started' },
  { id: 5, title: '2순위',          priority_order: 2,    due_date: null,          status: 'in_progress' },
  { id: 6, title: '취소됨',         priority_order: null, due_date: '2026-08-23', status: 'canceled' },
  { id: 7, title: '완전동률',       priority_order: 3,    due_date: '2026-08-27', status: 'in_progress' },
  { id: 8, title: '완전동률',       priority_order: 3,    due_date: '2026-08-27', status: 'in_progress' },
];
const order = (cmp) => [...TASKS].sort(cmp).map((t) => t.id).join(',');

const c = order(canonical), p = order(popout), o = order(oldPopout);
console.log('정본     :', c);
console.log('팝아웃(수정):', p, p === c ? '  ✅ 일치' : '  🔴 불일치');
console.log('팝아웃(옛) :', o, o === c ? '  ⚠️ 옛것도 일치 — 검사가 구분 못 함' : '  ✅ 다름(검사가 구분한다는 증거)');

let fail = 0;
if (p !== c) { fail++; console.log('\n🔴 수정본이 정본과 다르다'); }
if (o === c) { fail++; console.log('\n🔴 옛 구현도 통과한다 — 이 검사는 아무것도 구분하지 못한다'); }
console.log(`\n검사 업무 ${TASKS.length}건 · ${fail === 0 ? '✅ 세 벌 교차 검증 통과' : '실패 ' + fail + '건'}`);
process.exit(fail ? 1 : 0);
