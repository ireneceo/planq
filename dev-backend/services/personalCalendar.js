// services/personalCalendar.js — 개인 Google Calendar 일정 조회 (읽기 전용 overlay)
//
// external_connections (owner_scope='user', provider='google_calendar') 의 primary calendar
// 일정을 가져와 Q Calendar 에 violet overlay 로 표시. 쓰기 없음 (calendar.readonly scope).
const { google } = require('googleapis');
const personalOauth = require('./personalOauth');

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
    end_at: end.dateTime || (end.date ? `${end.date}T00:00:00` : null),
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
  const granted = String((conn && conn.scope) || '').split(/\s+/).filter(Boolean);
  return CALENDAR_WRITE_SCOPES.some((s) => granted.includes(s));
}

// PlanQ 원본 표식 — 되돌아온 자기 일정을 overlay 에 중복으로 그리지 않기 위해 반드시 붙인다.
function planqBody({ title, description, location, startAt, endAt, allDay, timezone, rrule }) {
  const tz = timezone || 'Asia/Seoul';
  const body = {
    summary: title,
    description: description || undefined,
    location: location || undefined,
    extendedProperties: { private: { planq: '1' } },
  };
  if (allDay) {
    body.start = { date: new Date(startAt).toISOString().slice(0, 10) };
    body.end = { date: new Date(endAt || startAt).toISOString().slice(0, 10) };
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
  return { id: resp.data.id, htmlLink: resp.data.htmlLink };
}

async function updateEvent(conn, gcalEventId, input) {
  const auth = await personalOauth.getAuthedClient(conn);
  const cal = google.calendar({ version: 'v3', auth });
  const resp = await cal.events.patch(
    { calendarId: 'primary', eventId: gcalEventId, requestBody: planqBody(input) },
    { timeout: 10000 },
  );
  return { id: resp.data.id };
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
  listEvents, isPlanqOrigin,
  hasCalendarWrite, insertEvent, updateEvent, deleteEvent, CALENDAR_WRITE_SCOPES,
};
