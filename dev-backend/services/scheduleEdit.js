// 일정 일괄 수정 — **날짜 연산의 단일 원천.**
//
// Irene 2026-09-10: *"전체 프로젝트 일정을 늘린다거나 마감기간 당기고 업무들 기간들 줄인다거나 …
//   전체적으로 잡고 싶거나 변경해야 할 때 엄두가 안나. 특히 기간들."*
//
// ★ 이 파일은 **DB 를 모른다.** 순수 함수만 둔다 —
//   ① 그래야 미리보기(쓰지 않음)와 적용(씀)이 **같은 계산**을 쓴다는 것이 보장된다.
//      두 벌이면 "미리보기에는 09/26 이라고 했는데 적용하니 09/27" 이 된다.
//   ② 그래야 경계(주말·월말·윤년·역전)를 기계로 전수 반증할 수 있다.
//   쓰기는 services/actions/task_actions.js 의 액션이 한다(이력·알림·소켓이 거기 붙어 있다).
//
// 설계: docs/AI_SCHEDULE_EDIT_DESIGN.md

/** 'YYYY-MM-DD' 만 다룬다. Date 객체를 밖으로 내보내지 않는다 — 타임존이 섞이는 순간 하루가 밀린다. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toUTC(d) {
  if (!d) return null;
  const s = String(d).slice(0, 10);
  if (!DATE_RE.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}
function fromUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
const DAY = 86400000;

/** 0=일 … 6=토 */
function dowUTC(ms) { return new Date(ms).getUTCDay(); }
function isWeekend(ms) { const d = dowUTC(ms); return d === 0 || d === 6; }

/**
 * 주말이면 **앞 영업일로 당긴다.**
 * ★ 뒤로 밀지 않는다 — 마감을 뒤로 미는 것은 사용자가 시키지 않은 지연이다.
 *   당기는 쪽은 "더 일찍 끝내라" 라 안전하고, 미는 쪽은 약속을 바꾼다.
 */
function toBusinessDay(ms) {
  let x = ms;
  while (isWeekend(x)) x -= DAY;
  return x;
}

/**
 * ① **이동** — 전체를 N일 뒤/앞으로. 기간 길이는 보존된다.
 * @param {{start_date?:string|null, due_date?:string|null}} task
 * @param {number} days  양수=뒤로, 음수=앞으로
 */
function shiftTask(task, days, { businessDays = true } = {}) {
  const s = toUTC(task.start_date);
  const e = toUTC(task.due_date);
  if (s === null && e === null) return null;                 // 날짜가 없으면 옮길 것이 없다
  const off = Math.trunc(days) * DAY;
  const out = {};
  if (s !== null) out.start_date = fromUTC(s + off);
  if (e !== null) out.due_date = fromUTC(businessDays ? toBusinessDay(e + off) : e + off);
  // 보정이 시작일을 넘겼으면 되돌린다 — 마감이 시작보다 빠를 수는 없다.
  if (out.start_date && out.due_date && toUTC(out.due_date) < toUTC(out.start_date)) {
    out.due_date = out.start_date;
  }
  return out;
}

/**
 * ② **목표 마감에 맞춰 비례 압축/확장.**
 *
 * 전체 스팬(가장 이른 시작 ~ 가장 늦은 마감)을 목표 마감까지로 바꾸고, 각 업무의 위치·길이를
 * 같은 비율로 줄이거나 늘린다. **최소 1일**은 보장한다 — 0일짜리 업무는 일정이 아니다.
 *
 * @param {Array} tasks  {id, start_date, due_date}
 * @param {string} targetDue 'YYYY-MM-DD'
 * @returns {{anchor:string, from:string, to:string, ratio:number, changes:Array}}
 *          changes: [{id, start_date?, due_date?}] — 바뀌는 것만
 */
function compressToTarget(tasks, targetDue, { businessDays = true } = {}) {
  const dated = (tasks || []).filter((t) => toUTC(t.start_date) !== null || toUTC(t.due_date) !== null);
  if (!dated.length) return null;
  const starts = dated.map((t) => toUTC(t.start_date) ?? toUTC(t.due_date));
  const ends = dated.map((t) => toUTC(t.due_date) ?? toUTC(t.start_date));
  const anchor = Math.min(...starts);          // 기준점 — 시작은 움직이지 않는다
  const last = Math.max(...ends);
  const target = toUTC(targetDue);
  if (target === null) return null;
  const span = last - anchor;
  const want = target - anchor;
  // 스팬이 0(전부 같은 날)이면 비율을 낼 수 없다 — 이동으로 처리해야 한다.
  if (span <= 0) return null;
  const ratio = want / span;
  if (!(ratio > 0)) return null;               // 목표가 기준점보다 빠르면 압축이 성립하지 않는다

  const changes = [];
  for (const t of dated) {
    const s0 = toUTC(t.start_date);
    const e0 = toUTC(t.due_date);
    const scale = (ms) => anchor + Math.round(((ms - anchor) * ratio) / DAY) * DAY;
    const patch = {};
    if (s0 !== null) patch.start_date = fromUTC(scale(s0));
    if (e0 !== null) {
      let e1 = scale(e0);
      if (businessDays) e1 = toBusinessDay(e1);
      // 최소 1일 — 압축이 심하면 시작=마감이 되어 버린다.
      const s1 = patch.start_date ? toUTC(patch.start_date) : null;
      if (s1 !== null && e1 < s1) e1 = s1;
      patch.due_date = fromUTC(e1);
    }
    // 안 바뀐 것은 안 싣는다 — 변경안이 실제 변경만 보여야 한다.
    const changed = (patch.start_date && patch.start_date !== String(t.start_date).slice(0, 10))
      || (patch.due_date && patch.due_date !== String(t.due_date).slice(0, 10));
    if (changed) changes.push({ id: t.id, ...patch });
  }
  return { anchor: fromUTC(anchor), from: fromUTC(last), to: targetDue, ratio, changes };
}

/**
 * 순서가 뒤집혔는지 **본다. 고치지 않는다.**
 *
 * ★ 임의 재배치를 하지 않는 이유: 무엇이 옳은 순서인지는 요구사항에서 자동으로 나오지 않는다.
 *   자동으로 섞으면 사용자가 시키지 않은 결정을 우리가 내리는 것이고, 그것은 되돌리기 어렵다.
 *   대신 **경고로 보고**해서 사람이 보고 판단하게 한다.
 *
 * @param {Array} after  [{id, title, start_date, due_date, order_index?}]
 * @returns {Array} [{id, title, reason}]
 */
function detectOrderBreaks(after) {
  const warns = [];
  const rows = (after || [])
    .filter((t) => toUTC(t.start_date) !== null && toUTC(t.due_date) !== null)
    .slice()
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (toUTC(cur.start_date) < toUTC(prev.start_date)) {
      warns.push({ id: cur.id, title: cur.title, reason: 'starts_before_previous' });
    }
  }
  return warns;
}

/** 완료·취소는 기본 제외 — 지난 일정을 소급해 바꾸면 걸린 시간 기록이 거짓이 된다. */
const CLOSED = ['completed', 'canceled'];
function isEditable(task, { includeClosed = false } = {}) {
  if (!includeClosed && CLOSED.includes(task.status)) return false;
  return toUTC(task.start_date) !== null || toUTC(task.due_date) !== null;
}

module.exports = {
  toBusinessDay, isWeekend,
  shiftTask, compressToTarget, detectOrderBreaks, isEditable,
  CLOSED,
  // 테스트·검증에서 쓰는 내부 헬퍼 (경계 반증용)
  _toUTC: toUTC, _fromUTC: fromUTC, DAY,
};
