// services/personalCalendar.js — 개인 Google Calendar 일정 조회 (읽기 전용 overlay)
//
// external_connections (owner_scope='user', provider='google_calendar') 의 primary calendar
// 일정을 가져와 Q Calendar 에 violet overlay 로 표시. 쓰기 없음 (calendar.readonly scope).
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
function normalize(ev, conn) {
  const start = ev.start || {};
  const end = ev.end || {};
  const allDay = !!start.date && !start.dateTime;
  return {
    id: `gcal-${conn.id}-${ev.id}`,
    source: 'personal_google',
    connection_id: conn.id,
    account_email: conn.account_email,
    title: ev.summary || '(제목 없음)',
    description: ev.description || null,
    location: ev.location || null,
    start_at: start.dateTime || (start.date ? `${start.date}T00:00:00` : null),
    // ★ 구글의 종일 end.date 는 **배타적**(마지막 날 다음 날)이다. 그대로 쓰면 PlanQ 화면에서
    //   하루 길게 보인다 — 하루짜리 일정이 이틀로 걸쳐 그려졌다.
    //   PlanQ 규약(마지막 날 23:59 포함)으로 되돌린다. 쓰기 경로의 +1 과 정확히 대칭.
    end_at: end.dateTime || (end.date ? `${exclusiveEndToInclusive(end.date)}T23:59:59` : null),
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
    read_only: !hasCalendarWrite(conn),
  };
}

// PlanQ 가 구글에 밀어 넣은 일정인가 — 되돌아온 자기 일정을 오버레이에 다시 그리면 중복이 된다.
//   신규 일정은 extendedProperties.private.planq='1' 로 표시된다(google_calendar.js).
//   그 표식이 없던 옛 일정은 CalendarEvent.gcal_event_id 대조로 걸러낸다(아래 excludeIds).
function isPlanqOrigin(ev) {
  const priv = (ev.extendedProperties && ev.extendedProperties.private) || {};
  return priv.planq === '1';
}

// conn 의 primary calendar 일정 (timeMin~timeMax ISO). 외부 호출 — 10s timeout.
//   excludeIds: PlanQ 가 만든 google event id 집합 (라우트가 CalendarEvent.gcal_event_id 로 채워 넘긴다)
async function listEvents(conn, { timeMin, timeMax, maxResults = 250, excludeIds = null }) {
  const auth = await personalOauth.getAuthedClient(conn);
  const cal = google.calendar({ version: 'v3', auth });
  const resp = await cal.events.list({
    calendarId: 'primary',
    timeMin, timeMax,
    singleEvents: true,      // 정기일정 인스턴스 펼침
    orderBy: 'startTime',
    maxResults,
    showDeleted: false,
  }, { timeout: 10000 });
  const items = resp.data.items || [];
  return items
    .filter(ev => ev.status !== 'cancelled' && (ev.start && (ev.start.dateTime || ev.start.date)))
    .filter(ev => !isPlanqOrigin(ev))                                   // PlanQ 가 만든 일정 (신규 표식)
    .filter(ev => !(excludeIds && excludeIds.has(String(ev.id))))       // PlanQ 가 만든 일정 (옛 데이터)
    .map(ev => normalize(ev, conn));
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
    body.start = { date: gcalDates.localDateStr(startAt, tz) };
    body.end = { date: gcalDates.allDayEndDateStr(endAt || startAt, tz) };
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
  const resp = await cal.events.insert(
    { calendarId: 'primary', requestBody: planqBody(input) },
    { timeout: 10000 },
  );
  // etag — google_calendar.insertEvent 와 같은 shape. 역방향 에코 필터의 1차 근거.
  return { id: resp.data.id, htmlLink: resp.data.htmlLink, etag: resp.data.etag || null };
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
  const resp = await cal.events.insert({
    calendarId: 'primary',
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

async function updateEvent(conn, gcalEventId, input) {
  const auth = await personalOauth.getAuthedClient(conn);
  const cal = google.calendar({ version: 'v3', auth });
  const resp = await cal.events.patch(
    { calendarId: 'primary', eventId: gcalEventId, requestBody: planqBody(input) },
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

async function patchPersonalOriginEvent(conn, gcalEventId, patch, { etag = null } = {}) {
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
      body.start = { date: plainDate(startAt) || gcalDates.localDateStr(startAt, tz), dateTime: null };
      const endDate = plainDate(endAt);
      body.end = { date: endDate ? nextDay(endDate) : gcalDates.allDayEndDateStr(endAt, tz), dateTime: null };
    } else {
      body.start = { dateTime: new Date(startAt).toISOString(), timeZone: tz, date: null };
      body.end = { dateTime: new Date(endAt).toISOString(), timeZone: tz, date: null };
    }
  }

  const params = { calendarId: 'primary', eventId: gcalEventId, requestBody: body };
  // 참석자가 있는 회의의 시간이 바뀌었는데 참석자가 모르면 그게 사고다 (구글 UI 기본 동작과 동일).
  params.sendUpdates = 'all';
  const opts = { timeout: 10000 };
  // 동시 수정 충돌 — 구글에서 이미 바뀐 일정을 PlanQ 화면의 옛 값으로 덮어쓰지 않는다.
  if (etag) opts.headers = { 'If-Match': etag };

  const resp = await cal.events.patch(params, opts);
  return resp.data;
}

// 충돌(412) 시 최신본을 다시 읽어 화면에 돌려주기 위한 단건 조회.
async function getEvent(conn, gcalEventId) {
  const auth = await personalOauth.getAuthedClient(conn);
  const cal = google.calendar({ version: 'v3', auth });
  const resp = await cal.events.get({ calendarId: 'primary', eventId: gcalEventId }, { timeout: 10000 });
  return resp.data;
}

// 이미 사라진 이벤트(404/410)는 성공으로 친다 — 목적("구글에 없게 한다")이 이미 달성된 상태다.
async function deleteEvent(conn, gcalEventId) {
  const auth = await personalOauth.getAuthedClient(conn);
  const cal = google.calendar({ version: 'v3', auth });
  try {
    await cal.events.delete({ calendarId: 'primary', eventId: gcalEventId }, { timeout: 10000 });
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
};
