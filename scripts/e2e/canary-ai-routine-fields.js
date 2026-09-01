// scripts/e2e/canary-ai-routine-fields.js — #353 ⑤: **LLM 이 실제로 루틴 필드를 채우는가**
//
// 왜 필요한가 — #353 의 배관(후보 → 확정)은 손으로 만든 후보로 검증했다. 그건 서버가
//   필드를 **운반하는지**만 증명한다. 정작 사용자가 겪는 경로는 "매일 아침 논문 읽기" 라고
//   말했을 때 **LLM 이 recurrence_rule 을 내주는가** 다. 프롬프트가 조용히 바뀌거나
//   모델이 갈리면 배관이 멀쩡해도 루틴은 다시 만들어지지 않는다 — 그때 아무도 모른다.
//
// ★ LLM 을 실제로 호출한다(Cue 쿼터 소모). 그래서 기본 스위트에 넣지 않고 단독 실행한다.
//   `node scripts/e2e/canary-ai-routine-fields.js`
//
// ★ 판정은 **느슨하게, 그러나 공허하지 않게** 한다. LLM 출력은 비결정적이라 문자열 일치를
//   요구하면 거짓 실패가 난다. 대신 "명시적 반복 요청에 대해 유효한 RRULE 이 하나라도 나오는가"
//   로 본다. 그리고 **음성 대조군**(일회성 요청)을 같이 던져 "무조건 RRULE 을 뱉는 것"과
//   구별한다 — 대조군이 없으면 항상 통과하는 검사기가 된다.
const { BASE, CREDS } = require('./lib/browser');
const { RRule } = require('/opt/planq/dev-backend/node_modules/rrule');

const BIZ = Number(process.env.E2E_BUSINESS_ID || 5);
const OK_FREQ = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CREDS.email, password: CREDS.password }),
  });
  const j = await r.json();
  return j.data?.accessToken || j.data?.token || null;
}

async function plan(tok, prompt) {
  const r = await fetch(BASE + '/api/tasks/ai-create', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
    body: JSON.stringify({ business_id: BIZ, prompt }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, candidates: j.data?.candidates || [], raw: j };
}

// 파서가 해석한 FREQ 로 판정한다 — 원시 문자열 정규식은 `FREQ=DAILY;FREQ=HOURLY` 를 통과시킨다
// (rruleFromRecurrence.js 주석의 우회와 같은 이유).
function validRule(s) {
  if (!s || typeof s !== 'string') return null;
  try {
    const o = RRule.parseString(s);
    const freq = RRule.FREQUENCIES[o.freq];
    return OK_FREQ.has(String(freq).toUpperCase()) ? String(freq).toUpperCase() : null;
  } catch { return null; }
}

const CASES = [
  { label: '명시적 루틴 — 매일',   prompt: '매일 아침 논문 한 편 읽기 루틴 만들어줘. 마감일은 따로 없어.', wantRule: true },
  { label: '명시적 루틴 — 평일만', prompt: '평일 아침마다 SNS 계정 점검하는 반복 업무 추가해줘.',        wantRule: true },
  { label: '음성 대조군 — 일회성', prompt: '다음 주까지 사업계획서 초안 한 번 써줘.',                    wantRule: false },
];

async function run() {
  const tok = await login();
  const rows = [];
  if (!tok) {
    console.log('  ✗ 로그인 실패 — 검사 못 함');
    return [{ route: '로그인', detail: '실패', fail: 1 }];
  }
  for (const c of CASES) {
    let r;
    try { r = await plan(tok, c.prompt); }
    catch (e) { rows.push({ route: c.label, detail: '호출 오류: ' + e.message, fail: 1 }); continue; }
    if (r.status !== 200) {
      rows.push({ route: c.label, detail: `AI 호출 ${r.status} — ${JSON.stringify(r.raw).slice(0, 120)}`, fail: 1 });
      continue;
    }
    if (!r.candidates.length) {
      rows.push({ route: c.label, detail: '후보 0개 — 통과가 아니라 검사 실패', fail: 1 });
      continue;
    }
    const rules = r.candidates.map((x) => validRule(x.recurrence_rule)).filter(Boolean);
    const got = rules.length > 0;
    // ★ due_offset_days 를 같이 기록한다 — LLM 이 이것을 **빠뜨리는 빈도**가
    //   routes/tasks.js 의 앵커 분기(#353 ⑤)가 실제로 쓰이는지를 결정한다.
    //   빠뜨리지 않는다면 그 분기는 방어용이고, 빠뜨린다면 그것이 없으면 루틴이 죽는다.
    const dues = r.candidates.map((x) => x.due_offset_days);
    const missingDue = dues.filter((d) => d === null || d === undefined).length;
    const detail = `후보 ${r.candidates.length}개 · 유효 RRULE ${rules.length}개 [${rules.join(',') || '-'}]`
      + ` · due_offset_days ${JSON.stringify(dues)} (누락 ${missingDue})`
      + ` · 규칙 원문 ${JSON.stringify(r.candidates.map((x) => x.recurrence_rule)).slice(0, 70)}`;
    rows.push({ route: c.label, detail, fail: got === c.wantRule ? 0 : 1 });
  }
  const bad = rows.reduce((a, x) => a + (x.fail || 0), 0);
  console.log(`\nAI 루틴 필드 — 검사 ${rows.length}개 · 실패 ${bad}`);
  rows.forEach((x) => console.log(`  ${x.fail ? '✗' : '✓'} ${x.route} — ${x.detail}`));
  return rows;
}

module.exports = { name: 'AI 루틴 필드 (LLM 실호출)', run };

if (require.main === module) {
  run().then((rows) => {
    const bad = rows.reduce((a, x) => a + (x.fail || 0), 0);
    console.log('\n' + (bad === 0 ? '✓ PASS' : `✗ FAIL — ${bad}건`));
    process.exit(bad === 0 ? 0 : 1);
  }).catch((e) => { console.error('검사기 자체 오류:', e.message); process.exit(2); });
}
