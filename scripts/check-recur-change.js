#!/usr/bin/env node
// 반복 업무 «반복 설정 변경» 회귀 검사 — 실제 HTTP(3003) + dev DB.
//
// 2026-11-10 Irene: *"반복업무에서 반복설정 바꿨더니 과거 지연된 업무들 다 없어졌어. 나는 이 회차부터 적용 했는데."*
// 옛 코드(services/taskSeriesRecurrence) 실측 — 이 스크립트의 시나리오로 잰 값:
//   · 지난 회차(11/07)에서 «이 회차 이후» → 11/08·11/09 지연 업무 삭제 · 첫 회차에서 바꾸면 지연 5건 전부 삭제
//   · 5주 된 매주 월 → 매주 화 : 생성 커서가 시리즈 맨 처음으로 돌아가 10/13·10/20·10/27·11/03 가짜 지연 업무 4건 생성
// 판정
//   ① 오늘 이전(지연) 회차는 하나도 안 사라진다     ② 오늘 회차도 남는다
//   ③ 생성기를 돌려도 오늘 이전 날짜에 새 회차가 안 생긴다
//   ④ (음성 대조군) 경계 뒤 아직 시작 안 한 회차는 실제로 지워지고 새 규칙 날짜로 다시 생긴다 — 아무것도 안 하는 코드가 초록이 되지 않게
// 사용: node scripts/check-recur-change.js   (만든 시험 업무는 끝에 지운다)
const path = require('path');
const BE = path.join(__dirname, '../dev-backend');
require(path.join(BE, 'node_modules/dotenv')).config({ path: path.join(BE, '.env'), quiet: true });
const { Task } = require(path.join(BE, 'models'));
const gen = require(path.join(BE, 'services/recurringTaskGenerator'));
const { dateOnlyOf } = require(path.join(BE, 'utils/dateOnly'));

const BASE = process.env.API_BASE || 'http://127.0.0.1:3003';
const ymd = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
async function api(tok, m, p, b) {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return [r.status, await r.json().catch(() => null)];
}
async function series(pid) {
  const rows = await Task.findAll({ where: {}, raw: true, attributes: ['id', 'due_date', 'status', 'recurrence_parent_id'] });
  return rows.filter((t) => t.id === pid || t.recurrence_parent_id === pid).map((t) => ({ id: t.id, due: dateOnlyOf(t.due_date), status: t.status }));
}

let fail = 0;
const made = [];
function check(name, ok, detail) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fail += 1; }

async function scenario(tok, biz, { label, start, rule0, rule1, pick, scope }) {
  const today = ymd(0);
  const [cs, cj] = await api(tok, 'POST', '/api/tasks', { business_id: biz, title: `[확인용] 반복 변경 검사 ${label}`, due_date: ymd(start), recurrence_rule: rule0 });
  if (cs >= 300) throw new Error(`create ${cs} ${JSON.stringify(cj)}`);
  const pid = cj.data.id; made.push(pid);
  await gen.generateOneSeries(await Task.findByPk(pid), new Date());
  const before = await series(pid);
  const target = pick(before, pid);
  const [us, uj] = await api(tok, 'PUT', `/api/tasks/by-business/${biz}/${target}`, { recurrence_rule: rule1, series_scope: scope });
  check(`${label}: 저장 200`, us === 200, us !== 200 ? JSON.stringify(uj) : '');
  const afterPut = await series(pid);   // 자정 생성기 전 — 저장 직후 화면에 보이는 것
  await gen.generateOneSeries(await Task.findByPk(pid), new Date());
  const after = await series(pid);
  const ids = new Set(after.map((t) => t.id));
  const lostPast = before.filter((t) => t.due < today && !ids.has(t.id));
  check(`${label}: ① 지연 회차 보존`, lostPast.length === 0, lostPast.map((t) => t.due).join(','));
  const lostToday = before.filter((t) => t.due === today && !ids.has(t.id));
  check(`${label}: ② 오늘 회차 보존`, lostToday.length === 0, lostToday.map((t) => t.due).join(','));
  const beforeIds = new Set(before.map((t) => t.id));
  const ghosts = after.filter((t) => !beforeIds.has(t.id) && t.due < today);
  check(`${label}: ③ 지난 날짜 가짜 회차 0`, ghosts.length === 0, ghosts.map((t) => t.due).join(','));
  return { before, after, afterPut, beforeIds, today };
}

(async () => {
  const [ls, lj] = await api(null, 'POST', '/api/auth/login', { email: process.env.E2E_EMAIL || 'health-check@planq.kr', password: process.env.E2E_PASSWORD || 'HealthCheck2026!' });
  if (ls !== 200) throw new Error('login ' + ls);
  const tok = lj.data.access_token || lj.data.accessToken || lj.data.token;
  const biz = lj.data.user.active_business_id || lj.data.user.business_id;
  try {
    // A. 지난(지연된) 회차를 열고 «이 업무부터»(future)
    await scenario(tok, biz, { label: 'A 지난 회차·future', start: -6, rule0: 'FREQ=DAILY', rule1: 'FREQ=WEEKLY', scope: 'future',
      pick: (b) => b.find((t) => t.due === ymd(-3)).id });
    // B. 첫 회차(부모)를 열고 future
    await scenario(tok, biz, { label: 'B 첫 회차·future', start: -6, rule0: 'FREQ=DAILY', rule1: 'FREQ=WEEKLY', scope: 'future',
      pick: (b, pid) => pid });
    // C. 오래된 매주 시리즈 → 요일 변경, «내일부터»(all) — 커서가 시리즈 처음으로 돌아가면 ③ 이 깨진다
    const c = await scenario(tok, biz, { label: 'C 5주 매주 월→화·all', start: -35, rule0: 'FREQ=WEEKLY;BYDAY=MO', rule1: 'FREQ=WEEKLY;BYDAY=TU', scope: 'all',
      pick: (b) => b.filter((t) => t.due < ymd(0)).pop().id });   // 지난 회차를 연다(고친 업무 자신은 남으므로 ④ 판정에서 빠지게)
    // ④ 음성 대조군 — 내일 이후의 옛 규칙(월요일) 미착수 회차는 지워지고 새 규칙(화요일) 회차가 생겼는가
    const oldFutureLeft = c.after.filter((t) => c.beforeIds.has(t.id) && t.due > c.today && t.status === 'not_started');
    const newFuture = c.after.filter((t) => !c.beforeIds.has(t.id) && t.due > c.today);
    const allTue = newFuture.every((t) => new Date(`${t.due}T00:00:00Z`).getUTCDay() === 2);
    check('C: ④ 내일 이후 옛 규칙 회차 정리됨', oldFutureLeft.length === 0, oldFutureLeft.map((t) => t.due).join(','));
    check('C: ④ 새 규칙(화) 회차 생성됨', newFuture.length > 0 && allTue, newFuture.map((t) => t.due).join(','));
    // D. Irene 2026-11-10 실제 동작 — 오래된 매주 시리즈를 지난 회차에서 «평일 매일» 로. 바꾼 뒤 내일~7일 안 평일이 다 있어야 한다
    //    (옛 코드: 고친 업무 1개만 남고 그것도 지난 날짜 · 자정 생성기가 시리즈 처음부터 지난 평일을 지어냄)
    const dd = await scenario(tok, biz, { label: 'D 매주→평일 매일·all', start: -21, rule0: 'FREQ=WEEKLY;BYDAY=MO', rule1: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', scope: 'all',
      pick: (b) => b.filter((t) => t.due < ymd(0)).pop().id });
    const want = []; for (let n = 1; n <= 7; n += 1) { const s = ymd(n); const w = new Date(`${s}T00:00:00Z`).getUTCDay(); if (w >= 1 && w <= 5) want.push(s); }
    const have = new Set(dd.afterPut.map((t) => t.due));   // ★ 저장 직후(자정 생성기 전)에 이미 있어야 한다
    const missing = want.filter((s) => !have.has(s));
    const weekend = dd.after.filter((t) => !dd.beforeIds.has(t.id) && [0, 6].includes(new Date(`${t.due}T00:00:00Z`).getUTCDay()));
    check('D: 저장 직후 내일부터 7일 안 평일 회차 모두 있음', missing.length === 0, missing.join(','));
    check('D: 새로 생긴 주말 회차 0', weekend.length === 0, weekend.map((t) => t.due).join(','));
  } finally {
    for (const pid of made) await Task.destroy({ where: { recurrence_parent_id: pid } }).then(() => Task.destroy({ where: { id: pid } })).catch(() => {});
  }
  console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 반복 설정 변경 검사 통과');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
