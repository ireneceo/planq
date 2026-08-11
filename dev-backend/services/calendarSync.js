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

/**
 * 이 사용자의 개인 Google Calendar 연결 1개를 **결정적으로** 고른다.
 *
 * external_connections 의 unique 는 (business_id, owner_scope, user_id, provider, account_email) 라
 * 한 사용자가 워크스페이스별·계정별로 **여러 row** 를 가질 수 있다. 옛 코드는 정렬 없는 findOne 이라
 * 어느 것이 잡힐지 DB 순서에 맡겨져 있었다 — 선택이 호출마다 갈리면 링크 키(connection_id)가 표류해
 * reconcile 이 "빠진 목적지" 로 오판하고 **구글 이벤트를 지운다.**
 *
 * 우선순위: 같은 워크스페이스 → is_default → id 오름차순(가장 오래된 연결).
 * resolveTargets 와 resolveMeetSource 가 **반드시 이 헬퍼를 공유**한다. 갈리면 위 표류가 재발한다.
 */
async function pickPersonalConn(userId, businessId) {
  if (!userId) return null;
  const rows = await ExternalConnection.findAll({
    where: { owner_scope: 'user', user_id: userId, provider: 'google_calendar', is_active: true },
    order: [['is_default', 'DESC'], ['id', 'ASC']],
  });
  if (rows.length === 0) return null;
  // 같은 워크스페이스 연결이 있으면 그것부터. (order 절에 넣으면 dialect 별 표현이 갈려 명시 비교로 둔다)
  const sameBiz = businessId ? rows.find((r) => Number(r.business_id) === Number(businessId)) : null;
  return sameBiz || rows[0];
}

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
  //   ★ created_by 우선. 옛 코드는 `userId || created_by` 였는데 PUT 라우트가 `req.user.id` 를
  //     넘기므로, **admin 이 남의 일정을 고치면 목적지가 admin 으로 표류**했다 — 작성자 개인
  //     캘린더에서 일정이 삭제되고 admin 캘린더에 사본이 생겼다. 바로 위 주석이 명시한 의도
  //     ("일정 소유자 본인 것만")와 코드가 어긋나 있었다. 생성·본인수정 시엔 두 값이 같아 무변화.
  //     Cue 생성 일정은 actor 가 AI 멤버, created_by 가 위임자라 **위임자 캘린더로 간다** —
  //     에이전트 권한 모델(위임자 권한으로만 행동)과 정합인 의도된 변화다.
  const ownerId = event.created_by || userId;
  if (ownerId && wantsPersonal(event)) {
    const conn = await pickPersonalConn(ownerId, businessId);
    if (conn && conn.sync_enabled !== false && personalCalendar.hasCalendarWrite(conn)) {
      targets.push({ target: 'personal', connection_id: conn.id, user_id: ownerId, token: conn });
    }
  }
  return targets;
}

const keyOf = (t) => `${t.target}:${t.connection_id ?? ''}`;

/**
 * 목적지 실패를 **연동 레코드에** 기록한다 — target 종류를 가리지 않는다.
 *
 * ★ 왜 헬퍼인가: 여태 `if (t.target === 'workspace')` 분기만 있어 **개인 연동의 push 실패가
 *   아무 데도 기록되지 않았다.** 그래서 개인 연동이 죽어도 `last_sync_error` 는 영원히 null 이고,
 *   화면은 "정상" 이라 말하며, 서버는 그 연결을 계속 목적지로 골랐다.
 *   분기를 3곳에 복붙하면 또 한 곳이 빠진다 — 단일 헬퍼로 고정한다.
 */
async function recordTargetError(t, err) {
  if (!t) return;
  try {
    if (t.target === 'workspace') return await gcal.recordPushError(t.token, err);
    const conn = t.token || (t.connection_id ? await ExternalConnection.findByPk(t.connection_id) : null);
    if (conn) return await personalCalendar.recordConnError(conn, err);
  } catch (e) {
    console.error('[calendarSync] 실패 기록 자체가 실패:', e.message);
  }
}

/**
 * 목적지 성공 시 이전 오류 표시를 해제한다.
 *
 * ★ 이게 없으면 한 번 실패한 연결이 **영영 "연결 오류"** 로 남는다(일시적 네트워크 오류로도).
 * ★ 무조건 UPDATE 하지 않는다 — reconcile 은 일정 저장마다 도는데 매번 쓰면 쓰기 증폭이 된다.
 *   지울 것이 실제로 있을 때만 쓴다.
 */
async function clearTargetError(t) {
  if (!t) return;
  try {
    if (t.target === 'workspace') {
      const tok = t.token;
      if (tok && (tok.last_error || tok.last_error_at)) {
        await tok.update({ last_error: null, last_error_at: null });
      }
      return;
    }
    const conn = t.token;
    if (conn && (conn.last_sync_error || (conn.fail_count || 0) > 0)) {
      await conn.update({ last_sync_error: null, fail_count: 0, last_sync_at: new Date() });
    }
  } catch (e) {
    console.error('[calendarSync] 오류 해제 실패:', e.message);
  }
}

async function pushTo(t, event, tz) {
  const input = toInput(event, tz);
  if (t.target === 'workspace') {
    const cal = await gcal.getCalendarClient(t.token);
    const r = await gcal.insertEvent(cal, { ...input, summary: event.title });
    return r && { id: r.id, etag: r.etag || null };
  }
  const r = await personalCalendar.insertEvent(t.token, input);
  return r && { id: r.id, etag: r.etag || null };
}

async function updateAt(t, event, gcalEventId, tz) {
  const input = toInput(event, tz);
  if (t.target === 'workspace') {
    const cal = await gcal.getCalendarClient(t.token);
    const r = await gcal.updateEvent(cal, gcalEventId, { ...input, summary: event.title });
    return { etag: (r && r.etag) || null };
  }
  const r = await personalCalendar.updateEvent(t.token, gcalEventId, input);
  return { etag: (r && r.etag) || null };
}

/**
 * 링크만 가지고 내용 갱신 — wanted 에 없는 **보호 링크** 전용.
 *
 * 일반 update 루프는 토큰을 wanted 의 target 객체(`t.token`)에서 얻는데, 보호 링크는 wanted 에
 * 없으므로 그 토큰이 존재하지 않는다. removeAt 과 같은 방식으로 링크에서 토큰을 직접 조회한다.
 * 권한이 없거나 연결이 사라졌으면 조용히 skip — 갱신 실패가 일정 저장을 막을 이유는 없다(stale 허용).
 */
async function updateAtLink(link, event, businessId, tz) {
  const input = toInput(event, tz);
  let etag = null;
  if (link.target === 'workspace') {
    const token = businessId
      ? await BusinessCloudToken.findOne({ where: { business_id: businessId, provider: 'gcal' } })
      : null;
    if (!token || !gcal.hasWriteScope(token.scope)) return false;
    const cal = await gcal.getCalendarClient(token);
    const r = await gcal.updateEvent(cal, link.gcal_event_id, { ...input, summary: event.title });
    etag = (r && r.etag) || null;
  } else {
    const conn = await ExternalConnection.findByPk(link.connection_id);
    if (!conn || !personalCalendar.hasCalendarWrite(conn)) return false;
    const r = await personalCalendar.updateEvent(conn, link.gcal_event_id, input);
    etag = (r && r.etag) || null;
  }
  // 보호 링크도 우리가 민 것이므로 etag 를 갱신해야 역방향이 자기 변경을 되받지 않는다.
  if (etag && etag !== link.last_pushed_etag) await link.update({ last_pushed_etag: etag }).catch(() => {});
  return true;
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
  // 회수에서 살아남은 Meet 보유 링크 — wanted 에 없으므로 아래 일반 update 루프가 못 본다.
  // 내용 갱신은 별도 패스에서 자기 토큰을 직접 조회해 수행한다(stale 사본 방지).
  const protectedLinks = [];

  // 빠진 목적지 — 구글에서 지우고 링크 회수. ("체크 껐는데 구글에 남아 있다" 차단)
  const isPrivate = gcal.isPrivateForGcal(event);
  for (const [k, link] of have) {
    if (wanted.has(k)) continue;
    // ── Meet 보유 링크 보호 ──
    //   회의 링크는 **이미 참석자에게 배포된 자원**이다. 동기화 체크를 끄는 것과 회의를 파괴하는 것은
    //   다른 의사표시인데, 회수 루프는 그 둘을 구분하지 못했다. 보호 대상은 지우지 않고 내용만 갱신한다.
    //   실제 삭제는 ① 일정 삭제(removeEverywhere — 무조건) ② Meet 재발급 ③ 아래 비공개 carve-out.
    //
    //   ★ carve-out — 팀 캘린더 + 비공개 전환은 **보호를 무시하고 삭제한다.**
    //     공개 상태에서 워크스페이스 Meet 을 발급받은 뒤 L1/L2/personal 로 바꾸면, 보호를 그대로
    //     적용할 경우 owner 구글 캘린더에 일정이 남을 뿐 아니라 이후 수정까지 계속 push 된다.
    //     #126 "팀 캘린더로의 비공개 push 는 영구 금지" 정면 위반이다. 프라이버시가 회의 링크
    //     보존보다 우선한다 — 이 경우 회의는 죽고, 사용자는 다시 발급할 수 있다.
    const meetProtected = link.holds_meeting && !(link.target === 'workspace' && isPrivate);
    if (meetProtected) {
      protectedLinks.push(link);
      continue;
    }
    try {
      await removeAt(link, businessId);
      await link.destroy();
      out.removed++;
    } catch (e) {
      out.errors.push({ stage: 'remove', target: link.target, message: e.message });
      // 구글에서 못 지운 것도 연결 이상 신호다 — 여태 이 경로만 기록이 아예 없었다.
      await recordTargetError({ target: link.target, connection_id: link.connection_id }, e);
    }
  }

  // 새 목적지 — insert 후 링크 생성
  for (const [k, t] of wanted) {
    if (have.has(k)) continue;
    try {
      const r = await pushTo(t, event, tz);
      if (!r || !r.id) continue;
      await CalendarEventGcalLink.create({
        event_id: event.id, target: t.target, connection_id: t.connection_id,
        user_id: t.user_id, gcal_event_id: r.id,
        // insert 시점부터 etag 를 박는다 — 안 박으면 첫 폴링이 자기 insert 를 남의 변경으로 읽는다.
        last_pushed_etag: r.etag || null,
      });
      if (t.target === 'workspace') {
        // 옛 단일 컬럼도 계속 채운다 — 오버레이 중복 제거·기존 삭제 경로가 이 값을 본다(회귀 0).
        await event.update({ gcal_event_id: r.id }).catch(() => {});
      }
      await clearTargetError(t);
      out.added++;
    } catch (e) {
      out.errors.push({ stage: 'add', target: t.target, message: e.message });
      await recordTargetError(t, e);
    }
  }

  // 유지되는 목적지 — 내용 갱신
  for (const [k, t] of wanted) {
    const link = have.get(k);
    if (!link) continue;
    try {
      const r = await updateAt(t, event, link.gcal_event_id, tz);
      if (r && r.etag && r.etag !== link.last_pushed_etag) {
        await link.update({ last_pushed_etag: r.etag }).catch(() => {});
      }
      await clearTargetError(t);
      out.updated++;
    } catch (e) {
      const code = e && (e.code || e.status);
      if (code === 404 || code === 410) {
        // 구글 쪽에서 이미 사라짐 — 링크만 정리하면 다음 저장 때 다시 만들어진다.
        await link.destroy().catch(() => {});
        out.removed++;
      } else {
        out.errors.push({ stage: 'update', target: t.target, message: e.message });
        await recordTargetError(t, e);
      }
    }
  }

  // 보호된 Meet 링크 — 목적지에서 빠졌지만 살려둔 것들. 내용만 최신으로 맞춘다.
  //   안 하면 "회의는 살아 있는데 제목·시간이 옛날 그대로" 인 사본이 캘린더에 남는다.
  for (const link of protectedLinks) {
    try {
      if (await updateAtLink(link, event, businessId, tz)) out.updated++;
    } catch (e) {
      const code = e && (e.code || e.status);
      if (code === 404 || code === 410) {
        // 구글에서 이미 사라짐 — 보호할 대상 자체가 없다. 링크를 걷어야 다음 발급이 깨끗하다.
        await link.destroy().catch(() => {});
        out.removed++;
      } else {
        out.errors.push({ stage: 'update_protected', target: link.target, message: e.message });
      }
    }
  }
  return out;
}

/**
 * Meet 을 발급할 소스 결정 — **개인 연동 우선, 워크스페이스 폴백.**
 *
 * 왜 개인 우선인가: Meet 링크의 호스트는 캘린더 소유자다. 여태 워크스페이스 토큰만 봤기 때문에
 * **직원이 만든 회의의 호스트가 항상 사장(owner)** 이었고, 개인 연동만 한 직원은 Meet 을 아예
 * 만들 수 없었다(운영 실사례 2026-08-04).
 *
 * 일정 단위 토글(gcal_sync_*)·연동 단위 sync_enabled 는 **보지 않는다.** 그것들은 "자동 동기화"
 * 축이고, Meet 발급은 사용자가 그 자리에서 명시적으로 켠 1회 액션이라 축이 다르다.
 * 대신 발급된 링크는 holds_meeting 으로 보호되어 회수 루프에 삭제당하지 않는다.
 *
 * @returns {{kind:'personal', conn:object}|{kind:'workspace', token:object}|{kind:null, reason:string}}
 */
async function resolveMeetSource({ businessId, userId }) {
  const conn = await pickPersonalConn(userId, businessId);
  if (conn && personalCalendar.hasCalendarWrite(conn)) return { kind: 'personal', conn };
  const token = await BusinessCloudToken.findOne({ where: { business_id: businessId, provider: 'gcal' } });
  if (token && gcal.hasWriteScope(token.scope)) return { kind: 'workspace', token };
  // 왜 못 하는지를 구분해서 돌려준다 — 프론트가 "연결하기" 와 "다시 연결하기" 로 분기한다.
  if (conn || token) return { kind: null, reason: 'gcal_scope_missing' };
  return { kind: null, reason: 'gcal_not_connected' };
}

/** 소스 종류와 무관하게 같은 shape 을 돌려준다 — 호출측이 분기하지 않게. */
async function createMeeting(source, input) {
  if (source.kind === 'personal') return await personalCalendar.createMeetingEvent(source.conn, input);
  const cal = await gcal.getCalendarClient(source.token);
  return await gcal.createMeetingEvent(cal, input);
}

/** Meet 소스의 실패를 연동 레코드에 남긴다 (설정 화면의 "재연결 필요" 근거). */
async function recordMeetError(source, err) {
  if (!source || !source.kind) return;
  if (source.kind === 'personal') return await personalCalendar.recordConnError(source.conn, err);
  return await gcal.recordPushError(source.token, err);
}

/**
 * Meet 으로 만든 구글 이벤트를 링크 테이블에 등록한다.
 *
 * ★ 이게 없으면 다음 저장 때 reconcile 이 "이 목적지엔 링크가 없다" 고 판단해 **두 번째 이벤트를
 *   insert** 한다(구글 캘린더에 Meet 있는 사본 + 없는 사본이 나란히 남고, gcal_event_id 는 Meet
 *   없는 쪽으로 덮어써져 이후 삭제·재발급이 엉뚱한 이벤트를 잡는다). 실제로 그렇게 동작하고 있었다.
 *
 * unique 키가 (event_id, target, connection_id) 인데 workspace 는 connection_id 가 NULL 이라
 * MySQL unique 가 중복을 막지 못한다 — upsert 대신 findOne + create/update 로 멱등을 직접 만든다.
 */
async function linkMeeting(eventId, source, gcalEventId, businessId) {
  if (!gcalEventId || !source || !source.kind) return null;
  const target = source.kind === 'personal' ? 'personal' : 'workspace';
  const connectionId = source.kind === 'personal' ? source.conn.id : null;
  const userId = source.kind === 'personal' ? source.conn.user_id : null;
  const existing = await CalendarEventGcalLink.findOne({
    where: { event_id: eventId, target, connection_id: connectionId },
  });
  if (existing) {
    // ★ 이 목적지에 이미 있던 사본은 새 회의 이벤트로 **교체**된다. 지우지 않으면 그 캘린더에
    //   일정이 2개 보이고, 링크는 아래에서 새 id 로 재지정되므로 옛 사본은 **어떤 링크·컬럼으로도
    //   추적되지 않는 영구 고아**가 된다(404 자가치유 경로조차 안 걸린다).
    //   회의를 들고 있던 링크는 호출 전 clearMeetings 가 이미 걷으므로, 여기 걸리는 건
    //   reconcile 이 만든 **일반 동기화 사본**이다 — 그 자리를 회의 이벤트가 물려받는다.
    if (existing.gcal_event_id && existing.gcal_event_id !== gcalEventId) {
      try { await removeAt(existing, businessId); }
      catch (e) { console.warn('[linkMeeting 옛 사본 정리]', e.message); }
    }
    await existing.update({ gcal_event_id: gcalEventId, user_id: userId, holds_meeting: true });
    return existing;
  }
  return await CalendarEventGcalLink.create({
    event_id: eventId, target, connection_id: connectionId, user_id: userId,
    gcal_event_id: gcalEventId, holds_meeting: true,
  });
}

/**
 * 기존 Meet 보유 이벤트를 전부 정리한다 (재발급 전용).
 * 소스가 바뀌었을 수 있으므로(워크스페이스 → 개인) **소스 불문 전부** 지운다. 안 그러면 옛 Meet
 * 링크가 팀 캘린더에 살아남아 회의 링크가 두 개 유통된다.
 * best-effort — 구글 쪽 삭제가 실패해도 링크는 걷는다(다음 reconcile 이 새로 만든다).
 */
async function clearMeetings(eventId, businessId) {
  const links = await CalendarEventGcalLink.findAll({ where: { event_id: eventId, holds_meeting: true } });
  const cleared = links.map((l) => ({ target: l.target, gcal_event_id: l.gcal_event_id }));
  for (const link of links) {
    try { await removeAt(link, businessId); } catch (e) { console.warn('[clearMeetings]', e.message); }
    await link.destroy().catch(() => {});
  }
  // 무엇을 지웠는지 돌려준다 — 호출측이 옛 단일 컬럼(gcal_event_id)을 어떻게 정리할지 판단해야 한다.
  return cleared;
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

module.exports = {
  reconcile, removeEverywhere, resolveTargets, toInput, wantsWorkspace, wantsPersonal,
  pickPersonalConn, resolveMeetSource, createMeeting, recordMeetError, linkMeeting, clearMeetings,
  // 역방향 동기화(calendarReverseSync)가 사본 전파에 쓴다 — push 규칙을 두 벌로 만들지 않기 위해
  // 기존 함수를 그대로 노출한다.
  updateAtLink, recordTargetError, clearTargetError,
};
