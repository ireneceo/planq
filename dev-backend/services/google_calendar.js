// Google Calendar OAuth + API 래퍼 (사이클 N+13)
// scope: calendar.events — 이벤트 생성/수정 + conferenceData (Meet 링크) 발급 권한
//
// 디자인:
//   - GDrive 와 같은 OAuth client (GOOGLE_CLIENT_ID/SECRET 공용)
//   - redirect URI 만 다름 — GOOGLE_REDIRECT_URI 의 origin 재사용 + path 만 '/api/cloud/callback/gcal'
//   - workspace 단위 OAuth (owner 가 연결, business 의 google 계정 1개에 PlanQ 이벤트 mirror)
//   - 단방향 sync — PlanQ → Google Calendar (양방향 sync 는 추후)
//
// 회의 자동 생성:
//   events.insert 에 conferenceData.createRequest 옵션 포함 → Google 이 Meet 링크 발급
//   conferenceDataVersion=1 헤더 필수 (안 보내면 conferenceData 무시됨)

const { google } = require('googleapis');
const { BusinessCloudToken } = require('../models');

// 사이클 N+16-B — openid email 추가 (id_token 에 email claim 받기 위해).
// 옛 scope 만으로는 사용자 이메일 표시 불가했음 (callback 에 "계정: (확인 불가)" 회귀).
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
];

// 구글 동의 화면은 항목별 체크박스라, 사용자가 캘린더 항목을 체크하지 않아도 code 는 발급된다.
// granted scope 검사 없이 저장하면 화면에는 "연동 완료" 로 뜨지만 이후 모든 push 가
// 403 insufficientPermissions 로 죽는다 (2026-07-27 운영 사고 — 03:41 재연결이 openid email 만 받음).
// 판정은 services/googleScopes.js 단일 원천으로 위임한다. 같은 scope 목록이 여기와
// personalCalendar.js 두 벌로 있어, 한쪽만 고치면 팀 경로와 개인 경로가 다르게 판정됐다.
// 아래 상수·함수는 호출부 호환을 위한 얇은 wrapper 로만 남긴다.
const googleScopes = require('./googleScopes');

const CALENDAR_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const CALENDAR_FULL_SCOPE = 'https://www.googleapis.com/auth/calendar';

function hasWriteScope(scopeStr) {
  return googleScopes.hasRequired('gcal', scopeStr);
}

// ── 종일 일정 날짜 변환 (팀·개인 경로 공용 단일 원천) ──────────────────────────
//
// PlanQ 저장 규약: start_at = 시작일 로컬 00:00 / end_at = 종료일 로컬 23:59 (**마지막 날 포함**).
// Google 규약   : 종일 일정의 end.date 는 **배타적** — 마지막 날 **다음 날**을 넣어야 한다.
//
// 여태 두 군데가 틀려 있었다:
//   ① end 에 +1 을 안 해서 구글에서 하루 짧게(또는 0일이라 안 보이게) 나왔다.
//   ② `new Date(x).toISOString().slice(0,10)` 로 UTC 기준 날짜를 뽑아,
//      KST 00:00 = 전날 15:00Z 라 **시작일이 하루 앞으로 밀렸다.**
// 둘 다 종일 일정에서만 발현해 눈에 잘 안 띈다. 날짜는 반드시 **이벤트 타임존 기준**으로 뽑는다.
const DEFAULT_TZ = 'Asia/Seoul';

function localDateStr(value, tz) {
  // en-CA 로케일은 YYYY-MM-DD 를 준다 (수동 조립보다 안전).
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value));
}

// 마지막 날(포함) → 구글이 원하는 배타적 end (하루 뒤). 월·연 경계도 Date 가 처리한다.
function allDayEndDateStr(value, tz) {
  const [y, m, d] = localDateStr(value, tz).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

// GOOGLE_REDIRECT_URI 의 origin 만 재사용 (e.g. https://planq.kr) + '/api/cloud/callback/gcal'
function gcalRedirectUri() {
  const base = process.env.GOOGLE_REDIRECT_URI;
  if (!base) return null;
  try { return `${new URL(base).origin}/api/cloud/callback/gcal`; }
  catch { return null; }
}

function newOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    gcalRedirectUri()
  );
}

// state HMAC 패턴 — gdrive 와 동일 (CSRF 방어, 10분 TTL)
const STATE_TTL_MS = 10 * 60 * 1000;

function _hmacState(payloadB64) {
  const crypto = require('crypto');
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function buildAuthUrl(businessId, userId) {
  const client = newOAuth2Client();
  const payload = Buffer.from(JSON.stringify({ b: businessId, u: userId, t: Date.now() })).toString('base64url');
  const sig = _hmacState(payload);
  const state = `${payload}.${sig}`;
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
    include_granted_scopes: true,
  });
}

function parseState(state) {
  try {
    if (typeof state !== 'string' || !state.includes('.')) return null;
    const [payload, sig] = state.split('.', 2);
    const crypto = require('crypto');
    const expected = _hmacState(payload);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.t || Date.now() - Number(decoded.t) > STATE_TTL_MS) return null;
    return { businessId: decoded.b, userId: decoded.u, ts: decoded.t };
  } catch { return null; }
}

async function exchangeCodeForTokens(code) {
  const client = newOAuth2Client();
  const { tokens } = await client.getToken(code);
  let accountEmail = null;
  // 1차: id_token JWT payload 의 email claim (OpenID — 가장 안전, 호출 0회).
  // build URL 에 openid email scope 가 포함되어 있어야 동작.
  if (tokens.id_token) {
    try {
      const parts = String(tokens.id_token).split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (payload && payload.email) accountEmail = payload.email;
      }
    } catch (e) {
      console.warn('[gcal] id_token parse failed:', e.message);
    }
  }
  // 2차: calendar.calendarList.get('primary') 의 id (= 사용자 이메일)
  if (!accountEmail) {
    try {
      client.setCredentials(tokens);
      const cal = google.calendar({ version: 'v3', auth: client });
      const primary = await cal.calendarList.get({ calendarId: 'primary' });
      const id = primary.data?.id;
      if (id && id.includes('@')) accountEmail = id;
    } catch (e) {
      console.error('[gcal] primary calendarList.get failed:', e.message);
    }
  }
  return { tokens, accountEmail };
}

async function getCalendarClient(token) {
  const client = newOAuth2Client();
  client.setCredentials({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expiry_date: token.expires_at ? new Date(token.expires_at).getTime() : null,
  });
  client.on('tokens', async (fresh) => {
    try {
      const update = {};
      if (fresh.access_token) update.access_token = fresh.access_token;
      if (fresh.refresh_token) update.refresh_token = fresh.refresh_token;
      if (fresh.expiry_date) update.expires_at = new Date(fresh.expiry_date);
      if (Object.keys(update).length > 0) await token.update(update);
    } catch (e) { console.error('[gcal] token refresh save failed:', e.message); }
  });
  return google.calendar({ version: 'v3', auth: client });
}

async function getTokenForBusiness(businessId) {
  return await BusinessCloudToken.findOne({
    where: { business_id: businessId, provider: 'gcal' },
  });
}

/**
 * Google Calendar 이벤트 생성 + Meet 링크 자동 발급
 *
 * @param {object} cal       google.calendar 클라이언트
 * @param {object} input     { summary, description, startAt, endAt, attendeeEmails?, timezone?, rrule? }
 * @returns {object}         { id, htmlLink, hangoutLink, meetUrl, conferenceId }
 *
 * conferenceData.createRequest 가 핵심 — events.insert 시 conferenceDataVersion=1 헤더와 함께
 * 보내면 Google 이 Meet 링크 발급해서 응답의 hangoutLink + conferenceData.entryPoints 에 포함.
 *
 * 사이클 N+23 — rrule 파라미터 추가:
 *   PlanQ 의 정기 일정 rrule 을 Google Calendar 의 recurrence 필드 (RRULE 배열) 로 그대로 전달.
 *   → Google 이 정기 이벤트로 인식 → 모든 회차에 동일 Meet 링크 영구 유효.
 *   미전달 시 (단일) 첫 회차만 유효, 다음 회차에서 "회의 존재 안 함" 에러 발생하던 회귀 fix.
 */
async function createMeetingEvent(cal, { summary, description, startAt, endAt, attendeeEmails, timezone, rrule }) {
  const requestId = `planq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const tz = timezone || 'Asia/Seoul';
  // rrule 정규화 — Google API 는 ["RRULE:..."] 또는 ["RRULE:...", "EXDATE:..."] 배열을 받음.
  let recurrence = undefined;
  if (rrule && typeof rrule === 'string' && rrule.trim()) {
    const normalized = rrule.trim().startsWith('RRULE:') ? rrule.trim() : `RRULE:${rrule.trim()}`;
    recurrence = [normalized];
  }
  const res = await cal.events.insert({
    calendarId: 'primary',
    conferenceDataVersion: 1,  // ← 필수. 안 보내면 conferenceData 가 무시됨.
    sendUpdates: 'none',       // 초대장 메일 발송 안 함 (PlanQ 가 자체 알림 발송)
    requestBody: {
      summary: summary || 'PlanQ 회의',
      description: description || null,
      start: { dateTime: new Date(startAt).toISOString(), timeZone: tz },
      end:   { dateTime: new Date(endAt).toISOString(),   timeZone: tz },
      ...(recurrence ? { recurrence } : {}),
      // PlanQ 가 만든 일정이라는 표식 — 개인 Google 캘린더 오버레이가 이걸 보고 되돌아온
      // 자기 일정을 걸러낸다 (안 그러면 PlanQ 원본 + 구글 사본이 나란히 떠 이중으로 보인다).
      extendedProperties: { private: { planq: '1' } },
      attendees: Array.isArray(attendeeEmails)
        ? attendeeEmails.filter((e) => e && /@/.test(e)).map((email) => ({ email }))
        : undefined,
      conferenceData: {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    },
  });
  const ev = res.data;
  const meetEntry = (ev.conferenceData?.entryPoints || []).find((e) => e.entryPointType === 'video');
  return {
    id: ev.id,
    htmlLink: ev.htmlLink || null,
    hangoutLink: ev.hangoutLink || null,
    meetUrl: meetEntry?.uri || ev.hangoutLink || null,
    conferenceId: ev.conferenceData?.conferenceId || null,
  };
}

/**
 * 일반 일정 생성 (Meet 없이) — PlanQ 일반 일정을 Google Calendar 로 push.
 *   Meet 이벤트는 createMeetingEvent 가 담당. 여기선 conferenceData 없이 순수 이벤트만 insert.
 *   allDay 지원(date vs dateTime). planq='1' 표식으로 개인 오버레이 되돌이 중복 차단.
 * @returns {object} { id, htmlLink }
 */
async function insertEvent(cal, { summary, description, location, startAt, endAt, allDay, timezone, rrule, attendeeEmails }) {
  const tz = timezone || 'Asia/Seoul';
  let recurrence;
  if (rrule && typeof rrule === 'string' && rrule.trim()) {
    recurrence = [rrule.trim().startsWith('RRULE:') ? rrule.trim() : `RRULE:${rrule.trim()}`];
  }
  const start = allDay
    ? { date: localDateStr(startAt, tz) }
    : { dateTime: new Date(startAt).toISOString(), timeZone: tz };
  const end = allDay
    ? { date: allDayEndDateStr(endAt, tz) }   // 구글 종일 end 는 배타적 — 마지막 날 +1
    : { dateTime: new Date(endAt).toISOString(), timeZone: tz };
  const res = await cal.events.insert({
    calendarId: 'primary',
    sendUpdates: 'none',
    requestBody: {
      summary: summary || 'PlanQ 일정',
      description: description || null,
      location: location || null,
      start, end,
      ...(recurrence ? { recurrence } : {}),
      extendedProperties: { private: { planq: '1' } },
      attendees: Array.isArray(attendeeEmails)
        ? attendeeEmails.filter((e) => e && /@/.test(e)).map((email) => ({ email }))
        : undefined,
    },
  });
  return { id: res.data.id, htmlLink: res.data.htmlLink || null };
}

/**
 * 이벤트 업데이트 (PlanQ event 가 수정될 때 동기화)
 */
async function updateEvent(cal, gcalEventId, { summary, description, location, startAt, endAt, allDay, timezone }) {
  const tz = timezone || DEFAULT_TZ;
  const patch = {};
  if (summary !== undefined) patch.summary = summary;
  if (description !== undefined) patch.description = description;
  if (location !== undefined) patch.location = location;
  // ★ allDay 를 반드시 insert 와 같은 방식으로 처리한다.
  //   여태 updateEvent 는 allDay 를 받지도 않아 무조건 dateTime 으로 patch 했다 →
  //   구글에 올라간 **종일 일정이 제목 한 글자만 고쳐도 시간제(00:00~23:59)로 변형**됐다.
  //   insert 만 고치고 update 를 두면 같은 결함이 수정 경로로 되살아난다(Fable 게이트 지적).
  if (startAt) {
    patch.start = allDay
      ? { date: localDateStr(startAt, tz) }
      : { dateTime: new Date(startAt).toISOString(), timeZone: tz };
  }
  if (endAt) {
    patch.end = allDay
      ? { date: allDayEndDateStr(endAt, tz) }   // 구글 종일 end 는 배타적 — 마지막 날 +1
      : { dateTime: new Date(endAt).toISOString(), timeZone: tz };
  }
  const res = await cal.events.patch({
    calendarId: 'primary',
    eventId: gcalEventId,
    sendUpdates: 'none',
    requestBody: patch,
  });
  return res.data;
}

async function deleteEvent(cal, gcalEventId) {
  try {
    await cal.events.delete({ calendarId: 'primary', eventId: gcalEventId, sendUpdates: 'none' });
    return true;
  } catch (e) {
    // 410 Gone / 404 Not Found — 이미 사라진 이벤트
    if (e.code === 410 || e.code === 404) return true;
    throw e;
  }
}

// #126 보안 — 워크스페이스 gcal 은 연결한 owner 의 primary 캘린더에 쓴다. 따라서 개인(L1)·
//   팀 비공개(L2)·visibility='personal' 일정을 push 하면 남의 개인 일정이 owner 구글캘린더로
//   유출된다(share 라우트 calendar.js:990/1041 가 이미 막는 제한 레벨과 동일). 모든 gcal push
//   ingress(생성 push·push-to-gcal·PUT sync)가 이 단일 술어로 게이트한다 — 규칙 두 벌 금지.
function isPrivateForGcal(event) {
  return !!(event && (event.vlevel === 'L1' || event.vlevel === 'L2' || event.visibility === 'personal'));
}

// push 실패를 console.warn 으로만 남기면 아무도 모른다 — 2026-07-27 운영 사고에서 403 이
// 5일간 로그에만 쌓였다. 연동 레코드에 남겨 설정 화면이 "재연결 필요" 를 띄울 근거로 쓴다.
async function recordPushError(token, err) {
  if (!token) return;
  const msg = String(err?.message || err || 'unknown').slice(0, 300);
  try { await token.update({ last_error: msg, last_error_at: new Date() }); }
  catch (e) { console.error('[gcal] last_error 기록 실패:', e.message); }
}

// 성공하면 옛 오류 배지를 걷는다 (변화 없을 때 불필요한 UPDATE 는 하지 않는다).
async function clearPushError(token) {
  if (!token || !token.last_error) return;
  try { await token.update({ last_error: null, last_error_at: null }); }
  catch (e) { console.error('[gcal] last_error 해제 실패:', e.message); }
}

module.exports = {
  isConfigured,
  hasWriteScope,
  localDateStr,
  allDayEndDateStr,
  recordPushError,
  clearPushError,
  CALENDAR_WRITE_SCOPE,
  SCOPES,
  gcalRedirectUri,
  buildAuthUrl,
  parseState,
  exchangeCodeForTokens,
  getCalendarClient,
  getTokenForBusiness,
  createMeetingEvent,
  insertEvent,
  updateEvent,
  deleteEvent,
  isPrivateForGcal,
};
