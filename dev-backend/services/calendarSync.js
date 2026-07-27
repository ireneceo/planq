/**
 * 캘린더 동기화 단일 착지점 — 일정 하나를 "있어야 할 구글 캘린더들" 과 일치시킨다.
 *
 * 목적지 규칙 (Irene 결정 A, 2026-07-27):
 *   · 공개·업무 일정 (vlevel L3/L4, visibility business) → 팀 캘린더 + 본인 개인 캘린더
 *   · 비공개·개인 일정 (vlevel L1/L2, visibility personal) → **본인 개인 캘린더만**
 *
 * 이 규칙이 Irene 의 "디폴트는 다 연동 체크" 요구와 프라이버시를 동시에 만족시킨다 —
 * 비공개 일정도 체크가 켜져 있되 목적지가 본인 캘린더뿐이라 팀에 새지 않는다.
 * 팀 캘린더로의 비공개 push 는 #126 유출 차단 원칙 그대로 **영구 금지**다(gcal.isPrivateForGcal).
 *
 * 3중 토글 — 하나라도 꺼져 있으면 그 목적지는 제외된다:
 *   ① 일정 단위   calendar_events.gcal_sync_workspace / gcal_sync_personal (목적지별 각각)
 *   ② 연동 단위   business_cloud_tokens.sync_enabled / external_connections.sync_enabled
 *   ③ 권한        gcal.hasWriteScope / personalCalendar.hasCalendarWrite
 *
 * ★ reconcile 이 핵심이다. "원하는 목적지" 와 "지금 링크된 목적지" 를 비교해
 *   없으면 만들고, 빠졌으면 **구글에서 지우고** 링크를 끊는다. 지우지 않으면 사용자가
 *   체크를 꺼도 구글에 남아 "안 없어진다" 는 호소가 그대로 반복된다.
 */
const { CalendarEventGcalLink, BusinessCloudToken, ExternalConnection, Business } = require('../models');
const gcal = require('./google_calendar');
const personalCalendar = require('./personalCalendar');

// 일정 → 구글 이벤트 입력 shape (팀/개인 공용)
//   timezone 은 워크스페이스 설정(Business.timezone)을 실어 보낸다. 안 넘기면 항상 KST 기본값이라
//   비-KST 워크스페이스의 **종일 일정 날짜가 어긋난다**(날짜를 타임존 기준으로 뽑기 때문).
function toInput(event, timezone) {
  return {
    timezone: timezone || undefined,
    title: event.title,
    summary: event.title,
    description: event.description || null,
    location: event.location || null,
    startAt: event.start_at,
    endAt: event.end_at,
    allDay: !!event.all_day,
    rrule: event.rrule || null,
  };
}

/**
 * 이 일정이 가야 할 목적지 목록. 토글·권한을 전부 통과한 것만 남는다.
 * @returns {Promise<Array<{target:'workspace'|'personal', connection_id:number|null, user_id:number|null, token:object}>>}
 */
// 일정 단위 체크 — 팀/개인 각각. 옛 단일 컬럼(gcal_sync)에서 rename 됐으므로
//   혹시 남아 있는 옛 필드도 하위호환으로 인정한다(값이 undefined 면 기본 ON).
const wantsWorkspace = (e) => (e.gcal_sync_workspace !== false && e.gcal_sync_workspace !== 0)
  && (e.gcal_sync === undefined || (e.gcal_sync !== false && e.gcal_sync !== 0));
const wantsPersonal = (e) => e.gcal_sync_personal !== false && e.gcal_sync_personal !== 0;

async function resolveTargets(event, { businessId, userId }) {
  const targets = [];
  const isPrivate = gcal.isPrivateForGcal(event);

  // ── 팀 캘린더 — 공개·업무 일정만. 비공개는 체크와 무관하게 영구 금지(#126 유출 차단) ──
  if (!isPrivate && wantsWorkspace(event)) {
    const token = await BusinessCloudToken.findOne({ where: { business_id: businessId, provider: 'gcal' } });
    if (token && token.sync_enabled !== false && gcal.hasWriteScope(token.scope)) {
      targets.push({ target: 'workspace', connection_id: null, user_id: null, token });
    }
  }

  // ── 개인 캘린더 — 일정 소유자 본인 것만. 남의 개인 캘린더에 쓰지 않는다 ──
  const ownerId = userId || event.created_by;
  if (ownerId && wantsPersonal(event)) {
    const conn = await ExternalConnection.findOne({
      where: { owner_scope: 'user', user_id: ownerId, provider: 'google_calendar', is_active: true },
    });
    if (conn && conn.sync_enabled !== false && personalCalendar.hasCalendarWrite(conn)) {
      targets.push({ target: 'personal', connection_id: conn.id, user_id: ownerId, token: conn });
    }
  }
  return targets;
}

const keyOf = (t) => `${t.target}:${t.connection_id ?? ''}`;

async function pushTo(t, event, tz) {
  const input = toInput(event, tz);
  if (t.target === 'workspace') {
    const cal = await gcal.getCalendarClient(t.token);
    const r = await gcal.insertEvent(cal, { ...input, summary: event.title });
    return r && r.id;
  }
  const r = await personalCalendar.insertEvent(t.token, input);
  return r && r.id;
}

async function updateAt(t, event, gcalEventId, tz) {
  const input = toInput(event, tz);
  if (t.target === 'workspace') {
    const cal = await gcal.getCalendarClient(t.token);
    await gcal.updateEvent(cal, gcalEventId, { ...input, summary: event.title });
    return;
  }
  await personalCalendar.updateEvent(t.token, gcalEventId, input);
}

// 회수는 토글이 꺼져 있어도 수행한다 — "동기화 끔" 은 "구글에서 치워라" 라는 뜻이지
// "구글에 남겨둬라" 가 아니다. 권한이 없어 못 지우면 링크만 정리하고 넘어간다(best-effort).
async function removeAt(link, businessId) {
  if (link.target === 'workspace') {
    const token = businessId
      ? await BusinessCloudToken.findOne({ where: { business_id: businessId, provider: 'gcal' } })
      : null;
    if (!token || !gcal.hasWriteScope(token.scope)) return;
    const cal = await gcal.getCalendarClient(token);
    await gcal.deleteEvent(cal, link.gcal_event_id);
    return;
  }
  const conn = await ExternalConnection.findByPk(link.connection_id);
  if (!conn || !personalCalendar.hasCalendarWrite(conn)) return;
  await personalCalendar.deleteEvent(conn, link.gcal_event_id);
}

/**
 * 일정을 목적지들과 일치시킨다. 개별 목적지 실패는 삼키되(부분 성공 허용) 결과로 보고한다 —
 * 구글 한 곳이 죽었다고 PlanQ 일정 저장을 되돌리면 사용자가 일을 못 한다.
 * @returns {Promise<{added:number, updated:number, removed:number, errors:Array}>}
 */
async function reconcile(event, { businessId, userId }) {
  const out = { added: 0, updated: 0, removed: 0, errors: [] };
  const targets = await resolveTargets(event, { businessId, userId });
  // 워크스페이스 타임존 1회 조회 (목적지마다 다시 읽지 않는다). 없으면 google_calendar 의 기본값.
  let tz = null;
  try { tz = (await Business.findByPk(businessId, { attributes: ['timezone'] }))?.timezone || null; }
  catch { /* 조회 실패 시 기본 타임존으로 진행 — 동기화 자체를 막지는 않는다 */ }
  const links = await CalendarEventGcalLink.findAll({ where: { event_id: event.id } });

  const wanted = new Map(targets.map((t) => [keyOf(t), t]));
  const have = new Map(links.map((l) => [`${l.target}:${l.connection_id ?? ''}`, l]));

  // 빠진 목적지 — 구글에서 지우고 링크 회수. ("체크 껐는데 구글에 남아 있다" 차단)
  for (const [k, link] of have) {
    if (wanted.has(k)) continue;
    try {
      await removeAt(link, businessId);
      await link.destroy();
      out.removed++;
    } catch (e) {
      out.errors.push({ stage: 'remove', target: link.target, message: e.message });
    }
  }

  // 새 목적지 — insert 후 링크 생성
  for (const [k, t] of wanted) {
    if (have.has(k)) continue;
    try {
      const gid = await pushTo(t, event, tz);
      if (!gid) continue;
      await CalendarEventGcalLink.create({
        event_id: event.id, target: t.target, connection_id: t.connection_id,
        user_id: t.user_id, gcal_event_id: gid,
      });
      if (t.target === 'workspace') {
        // 옛 단일 컬럼도 계속 채운다 — 오버레이 중복 제거·기존 삭제 경로가 이 값을 본다(회귀 0).
        await event.update({ gcal_event_id: gid }).catch(() => {});
      }
      out.added++;
    } catch (e) {
      out.errors.push({ stage: 'add', target: t.target, message: e.message });
      if (t.target === 'workspace') await gcal.recordPushError(t.token, e);
    }
  }

  // 유지되는 목적지 — 내용 갱신
  for (const [k, t] of wanted) {
    const link = have.get(k);
    if (!link) continue;
    try {
      await updateAt(t, event, link.gcal_event_id, tz);
      out.updated++;
    } catch (e) {
      const code = e && (e.code || e.status);
      if (code === 404 || code === 410) {
        // 구글 쪽에서 이미 사라짐 — 링크만 정리하면 다음 저장 때 다시 만들어진다.
        await link.destroy().catch(() => {});
        out.removed++;
      } else {
        out.errors.push({ stage: 'update', target: t.target, message: e.message });
        if (t.target === 'workspace') await gcal.recordPushError(t.token, e);
      }
    }
  }
  return out;
}

/** 일정 삭제 시 — 모든 목적지에서 제거. (링크 row 는 FK ON DELETE CASCADE 로도 사라진다) */
async function removeEverywhere(eventId, businessId) {
  const links = await CalendarEventGcalLink.findAll({ where: { event_id: eventId } });
  let removed = 0;
  for (const link of links) {
    try { await removeAt(link, businessId); removed++; } catch (_) { /* best-effort */ }
    await link.destroy().catch(() => {});
  }
  return removed;
}

module.exports = { reconcile, removeEverywhere, resolveTargets, toInput, wantsWorkspace, wantsPersonal };
