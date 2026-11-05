// AI 에이전트 도구 — 날짜·시각 입력 해석 한 벌 (2026-11-05).
//
//   get_context 설명은 «다른 도구에 넘기는 날짜는 사용자 시간대로 해석된다» 고 약속하는데, 도구들은 `new Date(String(s))`
//   로 읽어 오프셋 없는 값을 **서버 시간대(UTC)** 로 풀었다. «오늘 일정» 에 from:"2026-11-05" 를 주면 한국 09:00~다음날 09:00 이
//   잡혀 아침 8시 회의가 빠지고 내일 아침 회의가 섞였다(점검 실측). 오프셋이 있으면 그대로, 없으면 사용자 시간대 벽시계로 푼다.
//   시간대 결정은 get_context 와 같은 순서 — users.timezone → 워크스페이스 timezone → Asia/Seoul.
const { err } = require('./errors');
const { wallToInstant } = require('../../utils/wallTime');

function validTz(tz) {
  if (!tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** 이 호출의 사용자 시간대 — 한 호출 안에서는 한 번만 읽는다(p 에 적어 둔다). */
async function userTz(p) {
  if (p && p._agentTz) return p._agentTz;
  const { Business, User } = require('../../models');
  const [biz, u] = await Promise.all([
    Business.findByPk(p.businessId, { attributes: ['timezone'] }),
    User.findByPk(p.userId, { attributes: ['timezone'] }),
  ]);
  const ws = validTz(biz?.timezone) ? biz.timezone : 'Asia/Seoul';
  const tz = validTz(u?.timezone) ? u.timezone : ws;
  if (p) p._agentTz = tz;
  return tz;
}

const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})$/;
const LOCAL_DT = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

function nextDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * 도구 입력 날짜·시각 → Date.
 *   - 오프셋 있음(Z·+09:00) → 그 순간 그대로
 *   - 'YYYY-MM-DDTHH:MM[:SS]' (오프셋 없음) → 사용자 시간대 벽시계
 *   - 'YYYY-MM-DD' → 사용자 시간대 그날 00:00. endOfDay 면 그날 끝(다음날 00:00 — 미만 비교용 / inclusive 면 -1ms)
 * 잘못된 값은 VALIDATION_ERROR + 예시(hint) — 모델이 한 번에 고쳐 다시 부르게.
 */
function parseAgentTime(v, field, tz, { endOfDay = false, inclusive = false } = {}) {
  const s = String(v == null ? '' : v).trim();
  const bad = () => err('VALIDATION_ERROR', 'invalid_datetime', {
    fields: { [field]: v },
    hint: `Use ISO 8601, e.g. "2026-11-05" (whole day in ${tz}), "2026-11-05T14:00" (local time in ${tz}) or "2026-11-05T14:00:00+09:00".`,
  });
  if (!s) throw bad();
  // 달·날 범위 — wallToInstant 는 13월·32일을 다음 달로 넘겨 받아 버린다(Fable 2026-11-05 지적)
  const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (dm) {
    const [y, mo, da] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
    const t = new Date(Date.UTC(y, mo - 1, da));
    if (mo < 1 || mo > 12 || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== da) throw bad();
  }
  let m = DATE_ONLY.exec(s);
  if (m) {
    if (!endOfDay) return wallToInstant(m[1], '00:00', tz);
    const end = wallToInstant(nextDate(m[1]), '00:00', tz);
    return inclusive ? new Date(end.getTime() - 1) : end;
  }
  if (!HAS_OFFSET.test(s)) {
    m = LOCAL_DT.exec(s);
    if (m) {
      const d = wallToInstant(m[1], `${m[2]}:${m[3]}`, tz);
      return m[4] ? new Date(d.getTime() + Number(m[4]) * 1000) : d;
    }
  }
  // 오프셋이 있는 ISO 모양만 그대로 받는다. 그 밖의 모양(«2026-11-5»·«11/05/2026»·«Nov 5 2026»)은 new Date 가 서버 시간대(UTC)로 풀어
  //   이 함수가 막으려던 증상이 그대로 돌아온다(Fable 2026-11-05 실측) — 거절하고 예시를 준다.
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(s)) throw bad();
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw bad();
  return d;
}

/** instant → 사용자 시간대 벽시계 문자열 'YYYY-MM-DDTHH:MM' (모델이 시간대 변환을 틀리지 않게 같이 싣는다) */
function localOf(at, tz) {
  if (!at) return null;
  const { wallOf } = require('../../utils/wallTime');
  const w = wallOf(at, tz);
  return `${w.date}T${w.time}`;
}

module.exports = { userTz, parseAgentTime, localOf, validTz };
