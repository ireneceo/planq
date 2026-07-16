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
    ? { date: new Date(startAt).toISOString().slice(0, 10) }
    : { dateTime: new Date(startAt).toISOString(), timeZone: tz };
  const end = allDay
    ? { date: new Date(endAt).toISOString().slice(0, 10) }
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
async function updateEvent(cal, gcalEventId, { summary, description, startAt, endAt, timezone }) {
  const tz = timezone || 'Asia/Seoul';
  const patch = {};
  if (summary !== undefined) patch.summary = summary;
  if (description !== undefined) patch.description = description;
  if (startAt) patch.start = { dateTime: new Date(startAt).toISOString(), timeZone: tz };
  if (endAt) patch.end = { dateTime: new Date(endAt).toISOString(), timeZone: tz };
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

module.exports = {
  isConfigured,
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
};
