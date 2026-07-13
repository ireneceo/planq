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

module.exports = { listEvents, isPlanqOrigin };
