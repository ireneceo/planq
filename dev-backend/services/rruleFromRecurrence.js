// AI 후보의 recurrence('none'|'daily'|'weekly'|'monthly') → RRULE 문자열.
//
// ★ 프론트 `utils/recurrence.ts buildPresetRRule` 과 **같은 규칙**이어야 한다.
//   AI 로 만든 정기업무와 손으로 만든 정기업무가 다른 문자열을 쓰면, 같은 "매주" 인데
//   드로어에서 열었을 때 preset 이 custom 으로 잡히거나 편집 저장 시 규칙이 바뀐다.
//   규칙(프론트와 동일):
//     daily   → FREQ=DAILY
//     weekly  → FREQ=WEEKLY;BYDAY=<기준일 요일>
//     monthly → FREQ=MONTHLY;BYMONTHDAY=<기준일 일자>
//   종료 조건은 붙이지 않는다(무기한) — 후보 단계에서 사용자가 종료를 지정할 방법이 없다.
const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// ★ #353 — 반복 규칙(RRULE) 문자열의 **단일 관문** (Fable 설계 게이트 2026-08-30).
//
//   프리셋 4종(none/daily/weekly/monthly)으로는 평일만·말일·BYSETPOS·분기·연간·종료조건을
//   **표현할 수 없다.** 그래서 RRULE 문자열을 직접 받아들이되, 아무 문자열이나 받으면 안 된다.
//
//   ★ FREQ 화이트리스트가 핵심이다. `FREQ=HOURLY` / `MINUTELY` 는 RRule.parseString 을
//     **통과하지만**, 정기 "업무" 로는 뜻이 없고 recurringTaskGenerator 안에서 날짜가 절사돼
//     시리즈의 다음 발생일이 **영구 고착**된다(매일 밤 시리즈당 31회 공회전).
//
//   ★★ 판정은 **파서가 해석한 freq** 로 한다. 원시 문자열 정규식으로 첫 FREQ 만 보면
//      `FREQ=DAILY;FREQ=HOURLY` 가 통과한다 — 정규식은 앞을, 파서는 **뒤를** 채택하기 때문이다.
//      (Fable 구현 검증 2026-08-30 이 실HTTP 로 DB 착지까지 실증한 우회다.)
//      애초에 FREQ 가 두 번 나오는 문자열은 뜻이 모호하므로 그 자체로 거절한다.
//
//   ※ 이 함수는 생성(task_actions.createTask)·수정(PUT /api/tasks/:id)·AI 후보 세 경로가
//     **같이** 쓴다. 한 곳만 막으면 다른 문으로 같은 값이 들어온다.
//   반환: { rule, reason }. rule 이 null 이면 호출부가 프리셋 폴백 또는 400 으로 내려간다.
const { RRule } = require('rrule');

// rrule 의 freq enum — YEARLY=0 · MONTHLY=1 · WEEKLY=2 · DAILY=3 · HOURLY=4 · MINUTELY=5 · SECONDLY=6.
// 업무 반복은 **일 단위 이상**만 뜻이 있다.
const MIN_FREQ_VALUE = RRule.DAILY;          // 3
const ALLOWED_FREQ = ['YEARLY', 'MONTHLY', 'WEEKLY', 'DAILY'];
const MAX_RULE_LEN = 300;

function sanitizeRRule(raw) {
  if (raw == null || raw === '') return { rule: null, reason: 'empty' };
  if (typeof raw !== 'string') return { rule: null, reason: 'not_a_string' };
  const rule = raw.trim().replace(/^RRULE:/i, '').toUpperCase();
  if (!rule) return { rule: null, reason: 'empty' };
  if (rule.length > MAX_RULE_LEN) return { rule: null, reason: 'too_long' };

  // FREQ 가 두 번 이상 = 뜻이 모호하다. 파서와 사람이 서로 다른 것을 읽는다.
  const freqCount = (rule.match(/(?:^|;)FREQ=/g) || []).length;
  if (freqCount === 0) return { rule: null, reason: 'no_freq' };
  if (freqCount > 1) return { rule: null, reason: 'duplicate_freq' };

  let opts;
  try {
    opts = RRule.parseString(rule);
  } catch (e) {
    return { rule: null, reason: `parse_error:${e.message}` };
  }
  if (!opts || opts.freq == null) return { rule: null, reason: 'parse_empty' };
  // ★ 파서가 실제로 해석한 값으로 판정한다 (문자열 앞부분이 아니라)
  if (opts.freq > MIN_FREQ_VALUE) return { rule: null, reason: `freq_not_allowed:${opts.freq}` };
  return { rule, reason: null };
}

function rruleFromRecurrence(recurrence, anchorDate) {
  const kind = String(recurrence || 'none').toLowerCase();
  if (!['daily', 'weekly', 'monthly'].includes(kind)) return null;
  if (!anchorDate) return null;                 // 마감일이 첫 발생일 — 없으면 반복 불가
  const d = new Date(`${anchorDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  switch (kind) {
    case 'daily': return 'FREQ=DAILY';
    case 'weekly': return `FREQ=WEEKLY;BYDAY=${WEEKDAY_CODES[d.getUTCDay()]}`;
    case 'monthly': return `FREQ=MONTHLY;BYMONTHDAY=${d.getUTCDate()}`;
    default: return null;
  }
}

module.exports = { rruleFromRecurrence, sanitizeRRule, ALLOWED_FREQ };
