// 설문 통계 — **계산 정본**. 화면은 숫자를 다시 셈하지 않는다. 설계 docs/SURVEY_V2_DESIGN.md §4.1
//
// 공식(검산 사례는 설계 §4.1 — 척도 10명 NPS +30·평균 7.9 / 별점 7명 평균 4.0 / 척도 10,10,0,0 → NPS 0):
//   평균(별점·척도) = Σ값 / 답한 수, 소수 1자리 · 평균(숫자) = 소수 2자리 · 0건이면 null(«–», 0 이 아니다)
//   분포 = 값별 건수(별점 1~5 · 척도 0~10 — 0건인 값도 키를 둔다)
//   NPS = 추천(9~10) 비율 − 비추천(0~6) 비율. 분모 = **그 문항에 답한 수**(전체 줄 수 아님). 정수 반올림.
//         답한 사람 0명이면 null — 0 과 구별한다(0 은 «추천 = 비추천» 이라는 결과다)
//   예/아니오 = 예 건수 / 답한 수, 정수 % · 0건이면 null
//   선택(하나·여럿) 비율의 분모 = 답한 사람(여럿은 합이 100% 를 넘는 게 정상)
const { SKIP_TYPES } = require('./survey');

const isAnswered = (x) => x !== undefined && x !== null && x !== '' && !(Array.isArray(x) && !x.length);
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;
const pctInt = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);

/** 정수 칸(별점·척도)의 평균·분포. lo~hi 밖 값·정수 아닌 값은 «답 안 함» 으로 친다(표에서 손으로 넣은 이상한 값). */
function intStats(answered, lo, hi) {
  const ns = answered.map(Number).filter((n) => Number.isInteger(n) && n >= lo && n <= hi);
  const dist = {};
  for (let k = lo; k <= hi; k += 1) dist[k] = 0;
  for (const n of ns) dist[n] += 1;
  const avg = ns.length ? round1(ns.reduce((a, b) => a + b, 0) / ns.length) : null;
  return { ns, dist, avg };
}

/** NPS — ns 는 0~10 정수 배열. */
function npsOf(ns) {
  if (!ns.length) return { nps: null, promoters: 0, passives: 0, detractors: 0 };
  const promoters = ns.filter((n) => n >= 9).length;
  const detractors = ns.filter((n) => n <= 6).length;
  const passives = ns.length - promoters - detractors;
  return { nps: Math.round(((promoters - detractors) / ns.length) * 100), promoters, passives, detractors };
}

/**
 * 칸별 통계. rows = 이미 범위로 거른 응답 줄. kind = 문서 종류('survey' | 'table').
 */
function statsOf(record, rows, kind = 'survey') {
  const skip = kind === 'table' ? new Set(['secret']) : SKIP_TYPES;
  const cols = (Array.isArray(record.columns) ? [...record.columns] : [])
    .filter((c) => c && c.id && !skip.has(c.type))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const vals = rows.map((r) => (r.values && typeof r.values === 'object' ? r.values : {}));
  return cols.map((c) => {
    const answered = vals.map((v) => v[c.id]).filter(isAnswered);
    const base = { id: c.id, name: c.name, type: c.type, answered: answered.length };
    if (c.type === 'rating') {
      const { ns, dist, avg } = intStats(answered, 1, 5);
      return { ...base, answered: ns.length, avg, dist };
    }
    if (c.type === 'scale') {
      const { ns, dist, avg } = intStats(answered, 0, 10);
      return { ...base, answered: ns.length, avg, dist, ...npsOf(ns) };
    }
    if (c.type === 'yesno') {
      const bools = answered.filter((x) => x === true || x === false || x === 'true' || x === 'false');
      const yes = bools.filter((x) => x === true || x === 'true').length;
      return { ...base, answered: bools.length, counts: { true: yes, false: bools.length - yes }, yes_pct: pctInt(yes, bools.length) };
    }
    if (c.type === 'select' || c.type === 'multi_select' || c.type === 'checkbox') {
      const counts = {};
      const keys = c.type === 'checkbox' ? ['true', 'false'] : (c.options || []).map(String);
      keys.forEach((k) => { counts[k] = 0; });
      for (const x of answered) {
        const list = Array.isArray(x) ? x : [c.type === 'checkbox' ? String(x === true || x === 'true') : String(x)];
        for (const k of list) counts[k] = (counts[k] || 0) + 1;
      }
      if (c.type === 'checkbox') counts.false = rows.length - (counts.true || 0);
      return { ...base, answered: c.type === 'checkbox' ? rows.length : answered.length, counts };
    }
    if (c.type === 'number') {
      const ns = answered.map(Number).filter(Number.isFinite);
      if (!ns.length) return { ...base, avg: null, min: null, max: null };
      return { ...base, avg: round2(ns.reduce((a, b) => a + b, 0) / ns.length), min: Math.min(...ns), max: Math.max(...ns) };
    }
    if (c.type === 'date' || c.type === 'datetime') {
      const byDay = {};
      for (const x of answered) { const d = String(x).slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; }
      return { ...base, by_day: byDay };
    }
    return { ...base, recent: answered.slice(-20).reverse().map((x) => String(x).slice(0, 300)) };
  });
}

/** 회차 응답률 = 응답한 받는 사람 / 보낸 받는 사람(sent·responded). 보낸 사람 0명이면 null. */
function responseRate(recipients) {
  const sent = recipients.filter((r) => r.status === 'sent' || r.status === 'responded').length;
  const responded = recipients.filter((r) => r.status === 'responded').length;
  return { sent, responded, rate: pctInt(responded, sent) };
}

module.exports = { statsOf, npsOf, intStats, responseRate };
