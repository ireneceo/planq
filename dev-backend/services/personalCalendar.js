// services/personalCalendar.js — 개인 Google Calendar 일정 조회 (읽기 전용 overlay)
//
// external_connections (owner_scope='user', provider='google_calendar') 의 보이기로 한 캘린더들(기본: 구글에서 체크해 둔 것,
// 목록 권한이 없으면 골라 둔 쓰기 캘린더 하나) 일정을 가져와 Q Calendar 에 overlay 로 표시.
const { google } = require('googleapis');
const personalOauth = require('./personalOauth');
const gcalDates = require('./google_calendar');   // 종일 날짜 변환 단일 원천

// 구글 종일 end.date(배타적) → PlanQ 마지막 날(포함). 쓰기측 allDayEndDateStr 의 역함수.
//   달력 산술은 Date.UTC 로 — 월·연·윤년 경계를 직접 계산하면 틀린다.
function exclusiveEndToInclusive(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

// Google 일정 → PlanQ 정규화 shape
//   cal — 이 일정을 읽어 온 캘린더({ id, summary, color, access_role }). 없으면 쓰기 캘린더(옛 호출부 호환).
//   ★ id 에 캘린더를 넣는다(2026-10-12, Fable 2단계 판정 5) — 초대 사본처럼 같은 eventId 가 두 캘린더에 뜨는 것이 정상이다.
//     화면은 id 를 파싱하지 않는다 — 캘린더는 calendar_id 로 따로 내린다.
function normalize(ev, conn, cal = null) {
  const start = ev.start || {};
  const end = ev.end || {};
  const allDay = !!start.date && !start.dateTime;
  const c = cal || { id: calendarIdOf(conn), summary: metaOf(conn).calendar_summary || null, color: null, access_role: 'owner' };
  return {
    id: `gcal-${conn.id}-${encodeURIComponent(c.id)}-${ev.id}`,
    calendar_id: c.id,
    calendar_name: c.summary || null,
    // 기본 캘린더의 구글 이름(summary)은 계정 이메일이다 — 화면이 «기본 캘린더» 로 부르도록 따로 내린다
    calendar_primary: !!(c.primary ?? (c.id === 'primary')),
    calendar_color: c.color || null,
    access_role: c.access_role || null,
    ical_uid: ev.iCalUID || null,
    source: 'personal_google',
    connection_id: conn.id,
    account_email: conn.account_email,
    title: ev.summary || '(제목 없음)',
    description: ev.description || null,
    location: ev.location || null,
    start_at: start.dateTime || (start.date ? `${start.date}T00:00:00.000Z` : null),   // 종일 = UTC 자정 부호화(utils/allDayDate)
    // ★ 구글의 종일 end.date 는 **배타적**(마지막 날 다음 날)이다. 그대로 쓰면 PlanQ 화면에서
    //   하루 길게 보인다 — 하루짜리 일정이 이틀로 걸쳐 그려졌다.
    //   PlanQ 규약(마지막 날 23:59 포함)으로 되돌린다. 쓰기 경로의 +1 과 정확히 대칭.
    end_at: end.dateTime || (end.date ? `${exclusiveEndToInclusive(end.date)}T23:59:59.000Z` : null),
    all_day: allDay,
    html_link: ev.htmlLink || null,
    organizer_email: (ev.organizer && ev.organizer.email) || null,
    // 구글 원본 일정을 PlanQ 에서 고치기 위한 필드들.
    //   합성 id(`gcal-{connId}-{eventId}`)를 프론트가 파싱해 쓰지 않도록 원본 값을 그대로 내려준다.
    gcal_event_id: ev.id,
    etag: ev.etag || null,                                   // 동시 수정 충돌 감지 (If-Match)
    recurring_event_id: ev.recurringEventId || null,         // 있으면 반복 일정의 한 회차
    // 주최자가 아니면 구글이 어차피 수정을 거부한다 — 화면에서 미리 알린다.
    is_organizer: ev.organizer ? !!(ev.organizer.self || ev.organizer.email === conn.account_email) : true,
    // ★ 여태 무조건 true 였다. 그래서 쓰기 권한(calendar.events)에 동의한 사용자도 화면에서
    //   "읽기 전용" 을 보고 있었다 — 권한이 아니라 문구가 옛 동작을 서술하고 있던 것.
    //   캘린더 권한도 본다 — 공휴일·구독·읽기 공유 캘린더는 구글이 수정을 거부한다.
    read_only: !hasCalendarWrite(conn) || !isWritableRole(c.access_role),
  };
}
// 구글 캘린더 접근 권한(ACL) — 워크스페이스 역할과 무관하다.
function isWritableRole(accessRole) { return accessRole === 'owner' || accessRole === 'writer'; }

// PlanQ 가 구글에 밀어 넣은 일정인가 — 되돌아온 자기 일정을 오버레이에 다시 그리면 중복이 된다.
//   신규 일정은 extendedProperties.private.planq='1' 로 표시된다(google_calendar.js).
//   그 표식이 없던 옛 일정은 CalendarEvent.gcal_event_id 대조로 걸러낸다(아래 excludeIds).
function isPlanqOrigin(ev) {
  const priv = (ev.extendedProperties && ev.extendedProperties.private) || {};
  return priv.planq === '1';
}

// 일정 조회 캐시 — 월·주를 왔다 갔다 하면 같은 범위를 여러 번 묻는다(2026-10-12, Fable 2단계 판정 4 · 60초).
//   키 = 연결 × 캘린더 × 범위. 담는 것은 구글 원본(취소·PlanQ 표식 거른 뒤) — excludeIds 는 꺼낼 때 건다.
//   이 연결의 일정을 PlanQ 에서 고치거나 지우면 invalidateEvents(conn.id) 로 비운다(고친 직후 옛 값이 다시 그려지지 않게).
const EVENTS_TTL_MS = 60 * 1000;
const EVENTS_CACHE_MAX = 500;
const eventsCache = new Map();
function invalidateEvents(connId) {
  const prefix = `${connId}|`;
  for (const k of eventsCache.keys()) if (k.startsWith(prefix)) eventsCache.delete(k);
}

// conn 의 한 캘린더 일정 (timeMin~timeMax ISO). 외부 호출 — 10s timeout.
//   cal: 읽을 캘린더({ id, summary, color, access_role }) — 없으면 쓰기 캘린더(옛 호출부: Cue 맥락).
//   excludeIds: PlanQ 가 만든 google event id 집합 (라우트가 CalendarEvent·링크 표로 채워 넘긴다)
async function listEvents(conn, { timeMin, timeMax, maxResults = 250, excludeIds = null, cal = null, useCache = false }) {
  const calendarId = (cal && cal.id) || calendarIdOf(conn);
  const key = `${conn.id}|${calendarId}|${timeMin}|${timeMax}|${maxResults}`;
  let raw = null;
  if (useCache) {
    const hit = eventsCache.get(key);
    if (hit && Date.now() - hit.at < EVENTS_TTL_MS) raw = hit.items;
  }
  if (!raw) {
    const auth = await personalOauth.getAuthedClient(conn);
    const api = google.calendar({ version: 'v3', auth });
    const resp = await api.events.list({
      calendarId,
      timeMin, timeMax,
      singleEvents: true,      // 정기일정 인스턴스 펼침
      orderBy: 'startTime',
      maxResults,
      showDeleted: false,
    }, { timeout: 10000 });
    raw = (resp.data.items || [])
      .filter(ev => ev.status !== 'cancelled' && (ev.start && (ev.start.dateTime || ev.start.date)))
      .filter(ev => !isPlanqOrigin(ev));                                // PlanQ 가 만든 일정 (신규 표식)
    if (useCache) {
      if (eventsCache.size >= EVENTS_CACHE_MAX) eventsCache.delete(eventsCache.keys().next().value);
      eventsCache.set(key, { at: Date.now(), items: raw });
    }
  }
  return raw
    .filter(ev => !(excludeIds && excludeIds.has(String(ev.id))))       // PlanQ 가 만든 일정 (옛 데이터)
    .map(ev => normalize(ev, conn, cal));
}

// ── 쓰기 (2026-07-27 신설) ────────────────────────────────────────────────
// 여태 이 파일에는 쓰기가 한 줄도 없었다. 개인 연동은 calendar.readonly 라 구조적으로 불가였고,
// 그래서 "개인 캘린더 연동했는데 PlanQ 일정이 안 올라온다"(Irene) 는 고장이 아니라 기능 부재였다.
// PROVIDER_SCOPES.google_calendar 를 calendar.events 로 올리며 쓰기를 연다.

// 판정은 services/googleScopes.js 단일 원천. 아래는 호출부 호환용 wrapper.
const googleScopes = require('./googleScopes');

const CALENDAR_WRITE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar',
];

/**
 * 이 연결이 쓰기까지 되는가.
 * 기존 사용자는 calendar.readonly 로 동의해둔 상태라 재동의 전까지 false — 읽기 overlay 는 그대로
 * 두고 화면이 "다시 연결" 을 안내한다. 강제 해제하면 멀쩡한 읽기까지 잃는다.
 */
function hasCalendarWrite(conn) {
  return googleScopes.hasRequired('google_calendar', conn && conn.scope);
}

// ── 어느 구글 캘린더인가 (2026-10-07, Fable B 판정 8 — 여러 캘린더 중 고르기) ─────────────────────
//   골라 둔 캘린더 id 는 `external_connections.metadata.calendar_id`. 없으면 'primary'(기존 동작 그대로).
//   ★ 이미 밀어 넣은 일정은 **그 일정을 넣은 캘린더**(`calendar_event_gcal_links.gcal_calendar_id`)에서 고치고 지운다 —
//     캘린더를 바꾼 뒤 옛 일정을 새 캘린더 id 로 부르면 404 가 나고 구글에 고아가 남는다.
const CALENDAR_LIST_SCOPE = googleScopes.CALENDAR_LIST_SCOPE;   // 정본은 googleScopes(팀 연결과 같은 상수)
function metaOf(conn) {
  const m = conn && conn.metadata;
  if (!m) return {};
  if (typeof m === 'string') { try { return JSON.parse(m) || {}; } catch { return {}; } }
  return m;
}
function calendarIdOf(conn) {
  const id = metaOf(conn).calendar_id;
  return (typeof id === 'string' && id.trim()) ? id.trim() : 'primary';
}
// 이 연결의 쓰기 캘린더 이름 — 화면이 «어디로 올리는지» 를 적는 근거다(목록 권한 없이도).
//   기본 캘린더면 summary null(화면이 «기본 캘린더» 로 부른다). 고른 캘린더인데 이름이 비면 id 로 — 팀 축과 같은 규칙
//   (null 로 두면 화면이 «기본 캘린더» 라고 거짓으로 부른다 — Fable 2026-10-22 비차단). 연결 목록·일정 상태 응답이 같이 쓴다.
function calendarLabelOf(conn) {
  const id = calendarIdOf(conn);
  return { calendar_id: id, calendar_primary: id === 'primary', calendar_summary: id === 'primary' ? null : (metaOf(conn).calendar_summary || id) };
}
/** 캘린더 목록을 읽을 권한이 있는가 — 옛 연결은 «다시 연결하면 고를 수 있다» 로 안내한다. */
function hasCalendarList(conn) {
  return googleScopes.hasCalendarList(conn && conn.scope);
}
/**
 * 캘린더 목록.
 *   minAccessRole 'writer' = 일정을 올릴 캘린더 고르기(종전) · 'reader' = 보기/가리기 목록(공휴일·구독·읽기 공유 포함).
 *   ★ freeBusyReader 는 빼다 — events.list 가 제목 없는 «바쁨» 만 줘서 PlanQ 에서 뜻 없는 블록이 된다(Fable 2단계 판정 2).
 *   구글에서 숨긴(hidden) 캘린더는 목록에 두되 기본 꺼짐 — visibleCalendarsOf 가 정한다.
 */
async function listCalendars(conn, { minAccessRole = 'writer' } = {}) {
  const auth = await personalOauth.getAuthedClient(conn);
  const cal = google.calendar({ version: 'v3', auth });
  const out = [];
  let pageToken;
  do {
    const resp = await cal.calendarList.list({ minAccessRole, maxResults: 250, pageToken }, { timeout: 10000 });
    for (const c of (resp.data.items || [])) {
      if (c.deleted || c.accessRole === 'freeBusyReader') continue;
      out.push({
        id: c.id, summary: c.summaryOverride || c.summary || c.id, primary: !!c.primary, access_role: c.accessRole,
        color: c.backgroundColor || null, selected: !!c.selected, hidden: !!c.hidden,
      });
    }
    pageToken = resp.data.nextPageToken;
  } while (pageToken && out.length < 500);
  return out;
}

// ── 보기/가리기 (2026-10-12, Fable 2단계 판정 2·3) ─────────────────────────────────────────
//   Irene: *"다른 캘린더 앱은 구글캘린더 종류 다 가져와서 보기/가리기 다되는데"*
//   «올릴 캘린더»(calendar_id) 와 «볼 캘린더들»(visible_calendar_ids) 은 **다른 값**이다. 쓰기 캘린더는 늘 보인다(끌 수 없다) —
//   PlanQ 가 올린 일정이 사라져 보이는 혼선을 막는다.
const VISIBLE_MAX = 15;                       // 연결당 동시에 볼 수 있는 캘린더 수(조회 비용 상한)
const LIST_CACHE_TTL_MS = 24 * 3600 * 1000;   // 목록은 하루 한 번만 구글에 묻는다(토글할 때마다 묻지 않는다)

/** 읽을 수 있는 캘린더 목록(캐시). 목록 권한이 없는 옛 연결이면 null. 기본(primary) 캘린더의 id 는 'primary' 로 맞춘다. */
async function readableCalendars(conn, { force = false } = {}) {
  if (!hasCalendarList(conn)) return null;
  const meta = metaOf(conn);
  const cache = meta.calendar_list_cache;
  if (!force && cache && Array.isArray(cache.items) && Date.now() - Number(cache.at || 0) < LIST_CACHE_TTL_MS) return cache.items;
  const items = (await listCalendars(conn, { minAccessRole: 'reader' }))
    .map((c) => (c.primary ? { ...c, id: 'primary' } : c));
  try { await conn.update({ metadata: { ...meta, calendar_list_cache: { at: Date.now(), items } } }); }
  catch (e) { console.warn('[personalCalendar] list cache save failed conn=' + conn.id, e.message); }
  return items;
}

/**
 * 이 연결이 보여 줄 캘린더 — [{ id, summary, color, primary, access_role, visible, is_write }].
 *   items 가 null(목록 권한 없음)이면 **종전대로 쓰기 캘린더 하나**만 — 조용히 넓히지 않는다.
 *   저장된 visible_calendar_ids 가 없으면 구글에서 체크해 둔(selected·숨기지 않은) 캘린더 = 구글 화면과 같은 집합.
 */
function visibleCalendarsOf(conn, items) {
  const meta = metaOf(conn);
  const writeId = calendarIdOf(conn);
  if (!items) {
    return [{ id: writeId, summary: meta.calendar_summary || null, color: null, primary: writeId === 'primary',
      access_role: 'owner', visible: true, is_write: true }];
  }
  const stored = Array.isArray(meta.visible_calendar_ids) ? meta.visible_calendar_ids.map(String) : null;
  const want = new Set(stored || items.filter((c) => c.selected && !c.hidden).map((c) => c.id));
  want.add(writeId);
  const list = items.slice();
  if (!list.some((c) => c.id === writeId)) {
    list.unshift({ id: writeId, summary: meta.calendar_summary || null, color: null, primary: writeId === 'primary', access_role: 'owner' });
  }
  // 쓰기 캘린더를 맨 앞에 — 상한을 넘으면 뒤에서 자른다
  list.sort((a, b) => (b.id === writeId) - (a.id === writeId));
  let n = 0;
  return list.map((c) => {
    const on = want.has(c.id) && n < VISIBLE_MAX;
    if (on) n += 1;
    return { id: c.id, summary: c.summary || null, color: c.color || null, primary: !!c.primary,
      access_role: c.access_role || null, visible: on, is_write: c.id === writeId };
  });
}

/**
 * 일정을 고치거나 지울 캘린더가 허용되는가 — 화면이 보낸 calendar_id 를 그대로 믿지 않는다(Fable 2단계 판정 6).
 *   ① 쓰기 캘린더면 통과 ② 아니면 보이는 캘린더이고 그 캘린더 권한이 owner·writer 여야 한다.
 *   목록 캐시에 없으면 구글에 한 번 다시 묻는다. 그래도 없으면 거절(fail-closed).
 */
async function assertEditableCalendar(conn, calendarId) {
  const id = String(calendarId || '');
  if (!id) return { ok: false, error: 'calendar_id_required', status: 400 };
  if (id === calendarIdOf(conn)) return { ok: true, calendarId: id };
  let items = await readableCalendars(conn);
  if (!items) return { ok: false, error: 'calendar_not_allowed', status: 403 };
  if (!items.some((c) => c.id === id)) items = await readableCalendars(conn, { force: true });
  const hit = visibleCalendarsOf(conn, items).find((c) => c.id === id);
  if (!hit || !hit.visible || !isWritableRole(hit.access_role)) return { ok: false, error: 'calendar_not_allowed', status: 403 };
  return { ok: true, calendarId: id };
}

// PlanQ 원본 표식 — 되돌아온 자기 일정을 overlay 에 중복으로 그리지 않기 위해 반드시 붙인다.
function planqBody({ title, description, location, startAt, endAt, allDay, timezone, rrule }) {
  const tz = timezone || 'Asia/Seoul';
  const body = {
    summary: title,
    description: description || undefined,
    location: location || undefined,
    extendedProperties: gcalDates.planqMarker(),   // 표식은 팀·개인 한 벌 (인스턴스 env 포함)
  };
  if (allDay) {
    // 종일 날짜 변환은 팀 경로와 **같은 함수**를 쓴다 — 규칙이 두 벌이면 한쪽만 고쳐지고 어긋난다.
    body.start = { date: gcalDates.allDayStartDateStr(startAt) };
    body.end = { date: gcalDates.allDayEndDateStr(endAt || startAt) };
  } else {
    body.start = { dateTime: new Date(startAt).toISOString(), timeZone: tz };
    body.end = { dateTime: new Date(endAt || startAt).toISOString(), timeZone: tz };
  }
  if (rrule) {
    const arr = Array.isArray(rrule) ? rrule : [rrule];
    body.recurrence = arr.map((r) => (String(r).startsWith('RRULE:') ? String(r) : `RRULE:${r}`));
  }
  return body;
}

async function insertEvent(conn, input) {
  const auth = await personalOauth.getAuthedClient(conn);
  const cal = google.calendar({ version: 'v3', auth });
  const calendarId = calendarIdOf(conn);
  const resp = await cal.events.insert(
    { calendarId, requestBody: planqBody(input) },
    { timeout: 10000 },
  );
  // etag — google_calendar.insertEvent 와 같은 shape. 역방향 에코 필터의 1차 근거.
  //   calendarId — 링크에 남겨 둔다(그 캘린더에서 고치고 지운다).
  return { id: resp.data.id, htmlLink: resp.data.htmlLink, etag: resp.data.etag || null, calendarId };
}

/**
 * Google Meet 회의 발급 (개인 캘린더).
 *
 * 왜 필요한가 — 여태 Meet 은 **워크스페이스 토큰으로만** 발급됐다(google_calendar.createMeetingEvent).
 * 그래서 ① 개인 연동만 한 직원은 Meet 을 아예 못 만들었고 ② 만들어진 회의의 **호스트가 항상 owner**
 * 였다. 본인이 만든 회의는 본인이 호스트여야 한다.
 *
 * 반환 shape 은 google_calendar.createMeetingEvent 와 **동일하게** 맞춘다 — 호출측이 소스에 따라
 * 분기하지 않게 하기 위해서다(분기가 생기면 한쪽만 고쳐지는 회귀가 반복된다).
 */
async function createMeetingEvent(conn, { summary, title, description, location, startAt, endAt, timezone, rrule }) {
  const auth = await personalOauth.getAuthedClient(conn);
  const cal = google.calendar({ version: 'v3', auth });
  // 회의는 시간지정 일정이다 — allDay 는 전달하지 않는다(종일 일정에 Meet 을 걸 이유가 없다).
  const body = planqBody({
    title: title || summary || 'PlanQ 회의',
    description, location, startAt, endAt, allDay: false, timezone, rrule,
  });
  const requestId = `planq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const calendarId = calendarIdOf(conn);
  const resp = await cal.events.insert({
    calendarId,
    conferenceDataVersion: 1,   // ← 필수. 안 보내면 conferenceData 가 통째로 무시된다.
    sendUpdates: 'none',        // 초대장 메일은 PlanQ 가 자체 발송
    requestBody: {
      ...body,
      conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    },
  }, { timeout: 15000 });
  const ev = resp.data;
  const meetEntry = (ev.conferenceData?.entryPoints || []).find((e) => e.entryPointType === 'video');
  return {
    id: ev.id,
    htmlLink: ev.htmlLink || null,
    hangoutLink: ev.hangoutLink || null,
    meetUrl: meetEntry?.uri || ev.hangoutLink || null,
    conferenceId: ev.conferenceData?.conferenceId || null,
    calendarId,
  };
}

// 개인 연동의 push 실패 기록 — 워크스페이스의 gcal.recordPushError 와 같은 역할.
//   컬럼이 다르다(external_connections 는 last_sync_error/fail_count). 조용히 넘기면
//   "연동했는데 안 된다" 를 사용자도 우리도 알 수 없다.
async function recordConnError(conn, err) {
  if (!conn) return;
  const msg = String(err?.message || err || 'unknown').slice(0, 300);
  try { await conn.update({ last_sync_error: msg, fail_count: (conn.fail_count || 0) + 1 }); }
  catch (e) { console.error('[personalCalendar] last_sync_error 기록 실패:', e.message); }
}

async function updateEvent(conn, gcalEventId, input, { calendarId = null } = {}) {
  const auth = await personalOauth.getAuthedClient(conn);
  const cal = google.calendar({ version: 'v3', auth });
  const resp = await cal.events.patch(
    { calendarId: calendarId || calendarIdOf(conn), eventId: gcalEventId, requestBody: planqBody(input) },
    { timeout: 10000 },
  );
  return { id: resp.data.id, etag: resp.data.etag || null };
}

// ── 구글 원본 개인 일정 수정 (2026-08-19 신설) ─────────────────────────────
//
// ★ 위의 updateEvent 와 **절대 섞지 말 것.** 용도가 반대다.
//   · updateEvent      = PlanQ 가 만든 일정을 구글로 밀어넣는 경로. planqBody 가 PlanQ 표식을
//                        붙이며, 그 표식은 **반드시 유지돼야** 한다 (되돌아온 사본 중복 차단).
//   · 이 함수          = 사용자가 구글에서 직접 만든 개인 일정을 PlanQ 화면에서 고치는 경로.
//                        표식을 붙이면 두 가지 사고가 난다:
//                          ① listEvents 의 isPlanqOrigin 필터에 걸려 **일정이 화면에서 사라진다**
//                          ② calendarOrphanCleanup 이 'planq=1' 로 훑어 링크 없는 것을 고아로
//                             올린다 → 사용자가 정리를 실행하면 **개인 일정이 구글에서 삭제된다**
//   그래서 여기서는 extendedProperties 키를 **아예 넣지 않는다** (patch 미언급 = 원본 보존).
//   null 로 지우는 것도 금지 — PlanQ 와 무관한 확장 속성까지 날아간다.
//
// recurrence·attendees 도 넣지 않는다. 반복 일정의 한 회차(인스턴스 id)에 patch 하면 구글이
// 그 회차의 예외를 만들어 준다 — "이 일정만 수정" 이 별도 API 없이 지원된다.
//
// patch 값 규약이 planqBody 와 다르다: **null = 값 삭제**, 미포함 = 보존.
// (planqBody 는 undefined 로 보존을 표현한다 — 두 규약을 헷갈리면 사용자의 설명이 지워진다.)
// 오프셋 없는 로컬 날짜/시각 문자열이면 앞 10글자(YYYY-MM-DD)를 그대로 돌려준다.
//   Date 파싱을 거치지 않는 것이 요점 — 파싱하는 순간 서버 시간대가 끼어들어 날짜가 밀린다.
function plainDate(v) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ][\d:.]*)?$/.exec(String(v || ''));
  return m ? m[1] : null;
}

// 구글 종일 end 는 배타적 — 마지막 날 다음 날. 월·연 경계는 Date.UTC 가 처리한다.
function nextDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// ★ 구글 원본 개인 일정은 **그 일정을 읽어 온 캘린더**(calendarId — 라우트가 assertEditableCalendar 로 확인)에서 고친다.
//   2026-10-12 부터 여러 캘린더를 함께 보므로 쓰기 캘린더로 고정하면 다른 캘린더 일정이 404 가 난다.
async function patchPersonalOriginEvent(conn, gcalEventId, patch, { etag = null, calendarId = null } = {}) {
  const auth = await personalOauth.getAuthedClient(conn);
  const cal = google.calendar({ version: 'v3', auth });
  const tz = patch.timezone || 'Asia/Seoul';
  const body = {};
  if (patch.title !== undefined) body.summary = patch.title || '';
  if (patch.description !== undefined) body.description = patch.description || null;
  if (patch.location !== undefined) body.location = patch.location || null;

  // 시각을 바꿀 때는 start/end 를 **완전한 객체**로, 반대 변형을 명시 null 로 보낸다.
  //   구글 patch 는 start/end 하위 필드를 병합하므로, null 을 안 주면 종일 ↔ 시간지정 전환 시
  //   date 와 dateTime 이 공존해 400 이 난다.
  if (patch.startAt !== undefined || patch.endAt !== undefined || patch.allDay !== undefined) {
    const startAt = patch.startAt;
    const endAt = patch.endAt || patch.startAt;
    if (patch.allDay) {
      // ★ 종일은 **날짜 문자열을 그대로** 쓴다. `2026-08-17T23:59:59` 처럼 오프셋 없는 문자열을
      //   Date 로 파싱하면 서버 시간대(UTC)로 읽혀 KST 기준 하루가 밀린다 — 실측: end 가
      //   08-18 이어야 하는데 08-19 로 나갔다. 화면이 아는 것은 애초에 '날짜'다.
      //   (오프셋이 붙은 값이나 Date 객체가 들어오면 기존 단일 원천 함수로 되돌린다.)
      body.start = { date: plainDate(startAt) || gcalDates.allDayStartDateStr(startAt), dateTime: null };
      const endDate = plainDate(endAt);
      body.end = { date: endDate ? nextDay(endDate) : gcalDates.allDayEndDateStr(endAt), dateTime: null };
    } else {
      body.start = { dateTime: new Date(startAt).toISOString(), timeZone: tz, date: null };
      body.end = { dateTime: new Date(endAt).toISOString(), timeZone: tz, date: null };
    }
  }

  const params = { calendarId: calendarId || calendarIdOf(conn), eventId: gcalEventId, requestBody: body };
  // 참석자가 있는 회의의 시간이 바뀌었는데 참석자가 모르면 그게 사고다 (구글 UI 기본 동작과 동일).
  params.sendUpdates = 'all';
  const opts = { timeout: 10000 };
  // 동시 수정 충돌 — 구글에서 이미 바뀐 일정을 PlanQ 화면의 옛 값으로 덮어쓰지 않는다.
  if (etag) opts.headers = { 'If-Match': etag };

  const resp = await cal.events.patch(params, opts);
  return resp.data;
}

// 충돌(412) 시 최신본을 다시 읽어 화면에 돌려주기 위한 단건 조회.
async function getEvent(conn, gcalEventId, { calendarId = null } = {}) {
  const auth = await personalOauth.getAuthedClient(conn);
  const cal = google.calendar({ version: 'v3', auth });
  const resp = await cal.events.get({ calendarId: calendarId || calendarIdOf(conn), eventId: gcalEventId }, { timeout: 10000 });
  return resp.data;
}

// 이미 사라진 이벤트(404/410)는 성공으로 친다 — 목적("구글에 없게 한다")이 이미 달성된 상태다.
async function deleteEvent(conn, gcalEventId, { calendarId = null } = {}) {
  const auth = await personalOauth.getAuthedClient(conn);
  const cal = google.calendar({ version: 'v3', auth });
  try {
    await cal.events.delete({ calendarId: calendarId || calendarIdOf(conn), eventId: gcalEventId }, { timeout: 10000 });
  } catch (e) {
    const code = e && (e.code || e.status);
    if (code !== 404 && code !== 410) throw e;
  }
  return true;
}

module.exports = {
  listEvents, isPlanqOrigin, exclusiveEndToInclusive,
  hasCalendarWrite, insertEvent, updateEvent, deleteEvent, CALENDAR_WRITE_SCOPES,
  patchPersonalOriginEvent, getEvent, normalize,
  createMeetingEvent, recordConnError,
  calendarIdOf, calendarLabelOf, hasCalendarList, listCalendars, CALENDAR_LIST_SCOPE,
  readableCalendars, visibleCalendarsOf, assertEditableCalendar, invalidateEvents, isWritableRole, VISIBLE_MAX,
};
