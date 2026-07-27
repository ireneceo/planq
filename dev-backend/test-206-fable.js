// FABLE #206 UI/UX 사이클 실호출 검증 — 판정 후 rm
require('dotenv').config();
const mysql = require('mysql2/promise');
const BASE = 'http://localhost:3003';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let token = null;
const results = [];
function chk(name, ok, detail) { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); }

async function api(path, method = 'GET', body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch { /* noop */ }
  return { status: r.status, j };
}

(async () => {
  const db = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

  // 0. login
  const lg = await api('/api/auth/login', 'POST', { email: 'health-check@planq.kr', password: 'HealthCheck2026!' });
  token = lg.j?.data?.token;
  chk('login', !!token, 'status=' + lg.status);
  if (!token) process.exit(1);

  // 1. create task A (assignee=self)
  const cr = await api('/api/tasks', 'POST', { business_id: 5, title: 'FABLE-206 검증 A (삭제예정)', assignee_id: 5 });
  const A = cr.j?.data?.id;
  chk('create A', !!A, 'id=' + A);

  // 2. in_progress
  const p1 = await api(`/api/tasks/by-business/5/${A}`, 'PUT', { status: 'in_progress' });
  chk('A → in_progress', p1.status === 200 && p1.j?.data?.status === 'in_progress', 'status=' + p1.j?.data?.status);

  // 3. 반증 V3 — 비보류 상태에서 hold_reason 주입 → 저장되면 안 됨
  const p2 = await api(`/api/tasks/by-business/5/${A}`, 'PUT', { hold_reason: '유령사유 주입' });
  const d2 = await api(`/api/tasks/${A}/detail`);
  chk('반증: in_progress 에 hold_reason 주입 무시', p2.status === 200 && (d2.j?.data?.hold_reason == null), `put=${p2.status} refetch=${JSON.stringify(d2.j?.data?.hold_reason)}`);

  await sleep(5000);

  // 4. hold with reason (trim 확인)
  const h1 = await api(`/api/tasks/${A}/hold`, 'POST', { reason: '  고객 예산 재승인 대기  ' });
  chk('POST /hold', h1.status === 200 && h1.j?.data?.status === 'on_hold', 'status=' + h1.j?.data?.status);
  const d3 = await api(`/api/tasks/${A}/detail`);
  chk('hold_reason 저장(trim)', d3.j?.data?.hold_reason === '고객 예산 재승인 대기', JSON.stringify(d3.j?.data?.hold_reason));
  chk('hold_prev_status=in_progress', d3.j?.data?.hold_prev_status === 'in_progress', JSON.stringify(d3.j?.data?.hold_prev_status));

  // 5. 보류 중 사유 편집 (AutoSave 경로 = PUT hold_reason)
  const p3 = await api(`/api/tasks/by-business/5/${A}`, 'PUT', { hold_reason: '수정된 사유 v2' });
  const d4 = await api(`/api/tasks/${A}/detail`);
  chk('보류 중 PUT hold_reason 저장→재조회 일치', p3.status === 200 && d4.j?.data?.hold_reason === '수정된 사유 v2', JSON.stringify(d4.j?.data?.hold_reason));

  await sleep(5000);

  // 6. resume → prev(in_progress) 복귀 + hold 필드 초기화
  const r1 = await api(`/api/tasks/${A}/resume`, 'POST');
  chk('POST /resume → in_progress 복귀', r1.status === 200 && r1.j?.data?.status === 'in_progress', 'status=' + r1.j?.data?.status);
  const d5 = await api(`/api/tasks/${A}/detail`);
  chk('resume 후 hold 필드 초기화', d5.j?.data?.hold_reason == null && d5.j?.data?.hold_prev_status == null,
    `reason=${JSON.stringify(d5.j?.data?.hold_reason)} prev=${JSON.stringify(d5.j?.data?.hold_prev_status)}`);

  // 7. DB — event_type 실측 + 시간엔진 필터로 라운드 계산 (보류 구간 제외 실증)
  const [hist] = await db.query('SELECT from_status, to_status, event_type, created_at FROM task_status_history WHERE task_id=? ORDER BY created_at ASC, id ASC', [A]);
  console.log('history:', JSON.stringify(hist.map(h => `${h.from_status}->${h.to_status}[${h.event_type}]`)));
  const holdRows = hist.filter(h => h.to_status === 'on_hold' || h.from_status === 'on_hold');
  chk('hold/resume 이력 event_type=status_change', holdRows.length === 2 && holdRows.every(h => h.event_type === 'status_change'),
    JSON.stringify(holdRows.map(h => h.event_type)));
  // taskActualHours.js:45-66 과 동일 필터·알고리즘으로 닫힌 라운드 합산
  const filtered = hist.filter(h => h.event_type === 'status_change');
  let closedMs = 0, marker = null;
  for (const h of filtered) {
    const t = new Date(h.created_at).getTime();
    if (h.to_status === 'in_progress') { if (marker == null) marker = t; }
    else if (marker != null) { closedMs += Math.max(0, t - marker); marker = null; }
  }
  // in_progress ~5s → hold ~5s → resume. 닫힌 라운드 = 첫 in_progress 구간(~5s)만. 보류가 먹혔다면 ~10s.
  chk('시간엔진: 보류 구간 비누적 (닫힌 라운드 ≈5s)', closedMs >= 3500 && closedMs <= 8500, `closedMs=${closedMs}`);
  const [[taskRowA]] = await db.query('SELECT actual_hours, actual_source FROM tasks WHERE id=?', [A]);
  chk('actual_hours 보류시간 미포함(0.0h)', Number(taskRowA.actual_hours) === 0, `actual=${taskRowA.actual_hours} src=${taskRowA.actual_source}`);

  // 8. fallback — reviewing 에서 보류 → 컨펌자 제거 → resume 시 in_progress fallback
  const cr2 = await api('/api/tasks', 'POST', { business_id: 5, title: 'FABLE-206 검증 B (삭제예정)', assignee_id: 5 });
  const B = cr2.j?.data?.id;
  await api(`/api/tasks/by-business/5/${B}`, 'PUT', { status: 'in_progress' });
  const ar = await api(`/api/tasks/${B}/reviewers`, 'POST', { user_id: 1000024 });
  const sr = await api(`/api/tasks/${B}/submit-review`, 'POST');
  const h2 = await api(`/api/tasks/${B}/hold`, 'POST');
  const rm = await api(`/api/tasks/${B}/reviewers/1000024`, 'DELETE');
  const r2 = await api(`/api/tasks/${B}/resume`, 'POST');
  chk('fallback: reviewing 보류→컨펌자0→resume=in_progress', r2.j?.data?.status === 'in_progress',
    `addRev=${ar.status} submit=${sr.status}(${sr.j?.data?.status||sr.j?.message}) hold=${h2.status} rmRev=${rm.status} resume=${r2.status} status=${r2.j?.data?.status}`);

  // 9. 멀티테넌트 — 타 workspace task 에 hold
  const x1 = await api('/api/tasks/1063/hold', 'POST');
  chk('타 biz task hold → 403/404', x1.status === 403 || x1.status === 404, 'status=' + x1.status);
  const x2 = await api('/api/tasks/by-business/3/1063', 'PUT', { hold_reason: 'x' });
  chk('타 biz PUT → 403/404', x2.status === 403 || x2.status === 404, 'status=' + x2.status);

  // 10. 운영 옛 데이터 sample — legacy not_started task 회귀 0
  const lg1 = await api('/api/tasks/554/detail');
  chk('legacy task 554 detail 200 + status 유지', lg1.status === 200 && lg1.j?.data?.status === 'not_started' && lg1.j?.data?.hold_reason == null,
    `status=${lg1.j?.data?.status}`);

  // 11. cleanup — 생성한 A/B 삭제 (owner)
  const delA = await api(`/api/tasks/by-business/5/${A}`, 'DELETE');
  const delB = await api(`/api/tasks/by-business/5/${B}`, 'DELETE');
  chk('cleanup A/B 삭제', delA.status === 200 && delB.status === 200, `A=${delA.status} B=${delB.status}`);
  const [remain] = await db.query("SELECT id FROM tasks WHERE title LIKE 'FABLE-206 검증%'");
  chk('테스트 데이터 잔존 0', remain.length === 0, JSON.stringify(remain));

  await db.end();
  const fails = results.filter(r => !r.ok);
  console.log(`\n=== ${results.length - fails.length}/${results.length} PASS ===`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
