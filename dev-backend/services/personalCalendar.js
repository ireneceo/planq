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
    read_only: true,
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
  createMeetingEvent, recordConnError,
};
