// services/booking.js — 고객 창구 **상담 예약**의 유일한 문 (docs/CLIENT_ENTRY_DESIGN.md §4.3·§4.5·§4.6 · §5 P2)
//
// ★ `calendar_events.booking_status` 를 바꾸는 코드는 **이 파일에만** 있다.
//   상태가 바뀔 때마다 따라와야 하는 것 — 감사 · 실시간 · 팀 알림 · 고객 메일 · 영업 단계 — 을
//   전이 함수 안에서 한 번에 한다. 다른 곳에서 `event.update({ booking_status })` 를 부르면
//   그것들이 조용히 빠진다(salesStage.setStage 와 같은 규약).
//
// 상태 기계 (§4.6)
//   requested ──[승인]──▶ confirmed ──(end_at 지남)──▶ 끝남(파생) ──▶ client_interactions 1행(cron)
//      │  └──[다른 시간 제안]──▶ proposed ──[고객 수락]──▶ confirmed
//      │                          └──[고객: 다른 시간]──▶ requested(새 시간)
//      └──[거절]/[취소]──▶ declined | canceled
//
// ★ **고객이 일정을 «만드는» 것이 아니다.** 신청은 `created_by = 담당 멤버` 인 요청 행이다
//   (`event_actions.js` 의 «고객은 일정 생성 불가» 403 은 그대로 둔다 — §5 하지 말 것).
// ★ 신청 일정은 **참석자만 보인다**(vlevel L1 — 담당 멤버 = 만든 사람 + 참석자 고객).
//   그래서 워크스페이스 구글 캘린더(오너 계정)에는 올라가지 않는다(#126 isPrivateForGcal).
//   Meet 은 **담당 멤버 본인의 구글 연동**이 있을 때만 만든다 — 워크스페이스 토큰으로 만들면
//   오너 캘린더에 고객 이름이 올라간다.
const { Op } = require('sequelize');
const { RRule } = require('rrule');
const { sequelize } = require('../config/database');
const {
  Business, BusinessMember, CalendarEvent, CalendarEventAttendee, Client, ClientInteraction,
  Conversation, GuestLink,
} = require('../models');
const { createAuditLog } = require('./auditService');

const PURPOSES = ['new_project', 'quote', 'ongoing', 'other'];
const PURPOSE_LABEL = {
  ko: { new_project: '신규 프로젝트 상담', quote: '견적 상담', ongoing: '진행 중인 건', other: '기타 상담' },
  en: { new_project: 'New project', quote: 'Quote', ongoing: 'Ongoing work', other: 'Other' },
};
const ACTIVE = ['requested', 'proposed', 'confirmed'];
const MEMO_MAX = 500;
const MAX_OPEN_PER_CLIENT = 3;    // 한 고객이 동시에 걸어 둘 수 있는 «대기 중» 신청 수

class BookingError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

// ══════════════════════════════════════════════════════════════════════════
// 설정 — `businesses.permissions.customer_entry.booking` (새 컬럼 없음, §4.6)
// ══════════════════════════════════════════════════════════════════════════
const BOOKING_DEFAULTS = Object.freeze({
  enabled: false,        // ★ 기본은 꺼짐 — 켜는 것이 의식적 결정이다(열어 두면 모르는 사이에 신청이 쌓인다)
  member_id: null,       // 담당 멤버. 없으면 오너
  duration: 30,          // 30 | 60 분 — 격자 간격이기도 하다
  lead_hours: 24,        // 지금부터 이 시간 안의 슬롯은 내놓지 않는다
  daily_max: 4,          // 담당 멤버 하루 최대 예약 수(대기+확정)
});
const HORIZON_DAYS = 21;  // 몇 일 앞까지 보여 주나

/** 저장값 → 정본 모양. 읽기·쓰기 모두 이 함수를 지난다(customer_entry.normalizeIntro 와 같은 규약). */
function normalizeBooking(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const int = (v, lo, hi, d) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= lo && n <= hi ? n : d;
  };
  return {
    enabled: src.enabled === true,
    member_id: Number.isInteger(Number(src.member_id)) && Number(src.member_id) > 0 ? Number(src.member_id) : null,
    duration: [30, 60].includes(Number(src.duration)) ? Number(src.duration) : BOOKING_DEFAULTS.duration,
    lead_hours: int(src.lead_hours, 0, 168, BOOKING_DEFAULTS.lead_hours),
    daily_max: int(src.daily_max, 1, 20, BOOKING_DEFAULTS.daily_max),
  };
}

function bookingOf(biz) {
  const p = biz && biz.permissions && typeof biz.permissions === 'object' ? biz.permissions : {};
  const ce = p.customer_entry && typeof p.customer_entry === 'object' ? p.customer_entry : {};
  return normalizeBooking(ce.booking);
}

// ══════════════════════════════════════════════════════════════════════════
// 근무시간 — `businesses.work_hours` (§4.3). 컬럼은 있었지만 **모양이 정해진 적이 없다**
//   (routes/businesses.js PUT /settings 가 원문을 그대로 저장하고, 읽는 곳이 0곳이었다).
//   여기서 모양을 정한다: `{ mon: [9, 18], tue: [9, 18], …, sat: null }` — 시(小數 .5 허용).
//   모르는 모양은 **기본값**으로 떨어진다(평일 9–18). 무인증 표면의 계산 입력이라, 이상한 값에
//   던지지 않는다.
// ══════════════════════════════════════════════════════════════════════════
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_HOURS = [null, [9, 18], [9, 18], [9, 18], [9, 18], [9, 18], null];

function normalizeWorkHours(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = [];
  let any = false;
  for (let i = 0; i < 7; i += 1) {
    const v = raw[DAY_KEYS[i]] !== undefined ? raw[DAY_KEYS[i]] : raw[String(i)];
    if (v === null || v === undefined) { out.push(null); continue; }
    if (!Array.isArray(v) || v.length !== 2) return null;
    const a = Number(v[0]); const b = Number(v[1]);
    const okHalf = (n) => Number.isFinite(n) && n >= 0 && n <= 24 && Math.round(n * 2) === n * 2;
    if (!okHalf(a) || !okHalf(b) || a >= b) return null;
    out.push([a, b]);
    any = true;
  }
  return any ? out : null;
}
/** 요일(0=일)별 [시작분, 끝분] | null. */
function workHoursOf(biz) {
  const hours = normalizeWorkHours(biz && biz.work_hours) || DEFAULT_HOURS;
  return hours.map((h) => (h ? [Math.round(h[0] * 60), Math.round(h[1] * 60)] : null));
}
/** 저장용 정본 — 화면이 보낸 값을 이 모양으로만 저장한다(routes/businesses.js 가 부른다). */
function serializeWorkHours(raw) {
  const n = normalizeWorkHours(raw);
  if (!n) return null;
  const out = {};
  DAY_KEYS.forEach((k, i) => { out[k] = n[i]; });
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// 시간대 — 라이브러리 없이 Intl 로. 슬롯은 **워크스페이스 시간대의 벽시계**로 만들고 UTC 로 저장한다.
// ══════════════════════════════════════════════════════════════════════════
function safeTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'Asia/Seoul'; }
}
const _dtf = new Map();
function partsIn(date, tz) {
  let f = _dtf.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    _dtf.set(tz, f);
  }
  const p = {};
  for (const x of f.formatToParts(date)) p[x.type] = x.value;
  return {
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
    hh: Number(p.hour), mm: Number(p.minute), ss: Number(p.second),
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
  };
}
/** tz 가 UTC 보다 몇 분 앞서는가(그 순간 기준 — 서머타임 반영). */
function offsetMin(date, tz) {
  const p = partsIn(date, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - date.getTime()) / 60000);
}
/** tz 의 벽시계(y-m-d + 자정부터 분) → UTC Date. 서머타임 경계는 두 번 맞춘다. */
function wallToUtc(y, m, d, minutes, tz) {
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const o1 = offsetMin(new Date(guess), tz);
  let t = guess - o1 * 60000;
  const o2 = offsetMin(new Date(t), tz);
  if (o2 !== o1) t = guess - o2 * 60000;
  return new Date(t);
}
const dayKey = (p) => `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;

// ══════════════════════════════════════════════════════════════════════════
// 담당 멤버 — 고객의 담당(있으면) → 설정의 담당 → 오너. **지금 멤버인 사람만**(떠난 사람에게 가지 않는다).
// ══════════════════════════════════════════════════════════════════════════
async function isHumanMember(businessId, userId, transaction) {
  if (!userId) return false;
  const bm = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: userId }, attributes: ['role'], transaction,
  });
  return !!bm && bm.role !== 'ai';
}
async function resolveMemberId(biz, cfg, client, transaction) {
  for (const id of [client && client.assigned_member_id, cfg.member_id, biz.owner_id]) {
    if (await isHumanMember(biz.id, id, transaction)) return id;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
// 슬롯 계산 — 근무시간 ∩ (담당 멤버의 기존 일정 제외) ∩ (지금 + 리드타임) ∩ 하루 상한
//   ★ 응답에 나가는 것은 **시작 시각뿐**이다. 막힌 이유(누구의 무슨 일정)는 계산 안에서만 쓴다.
// ══════════════════════════════════════════════════════════════════════════
async function busyIntervals(businessId, memberId, from, to, { transaction, excludeEventId } = {}) {
  const attendeeRows = await CalendarEventAttendee.findAll({
    where: { user_id: memberId }, attributes: ['event_id'], raw: true, transaction,
  });
  const ids = attendeeRows.map((r) => r.event_id);
  const where = {
    business_id: businessId,
    all_day: false,
    [Op.and]: [
      { [Op.or]: [{ created_by: memberId }, ...(ids.length ? [{ id: { [Op.in]: ids } }] : [])] },
      // 거절·취소된 예약은 자리를 잡고 있지 않다
      { [Op.or]: [{ booking_status: null }, { booking_status: { [Op.in]: ACTIVE } }] },
      // 반복 일정은 원본 시작이 과거일 수 있어 기간 조건을 따로 건다
      { [Op.or]: [
        { rrule: { [Op.ne]: null }, start_at: { [Op.lt]: to } },
        { start_at: { [Op.lt]: to }, end_at: { [Op.gt]: from } },
      ] },
    ],
  };
  if (excludeEventId) where.id = { [Op.ne]: excludeEventId };
  const rows = await CalendarEvent.findAll({
    where,
    attributes: ['id', 'start_at', 'end_at', 'rrule', 'exception_dates', 'booking_status'],
    limit: 2000,
    transaction,
  });
  const out = [];
  for (const ev of rows) {
    const s = new Date(ev.start_at).getTime();
    const len = Math.max(0, new Date(ev.end_at).getTime() - s);
    if (!ev.rrule) { out.push([s, s + len, ev]); continue; }
    try {
      const opts = RRule.parseString(String(ev.rrule).replace(/^RRULE:/i, ''));
      opts.dtstart = new Date(s);
      const ex = new Set((Array.isArray(ev.exception_dates) ? ev.exception_dates : []).map((d) => String(d).slice(0, 10)));
      for (const occ of new RRule(opts).between(new Date(from.getTime() - len), to, true)) {
        if (ex.has(occ.toISOString().slice(0, 10))) continue;
        out.push([occ.getTime(), occ.getTime() + len, ev]);
      }
    } catch {
      // 해석 못 하는 반복 규칙은 **원본 한 번**만 막는다 — 던지면 슬롯 화면 전체가 죽는다.
      out.push([s, s + len, ev]);
    }
  }
  return out;
}

/**
 * @returns {Promise<{ slots: string[], duration: number, timezone: string, memberId: number|null }>}
 */
async function computeSlots(biz, { client = null, now = new Date(), transaction, excludeEventId } = {}) {
  const cfg = bookingOf(biz);
  const tz = safeTz(biz.timezone || 'Asia/Seoul');
  const memberId = await resolveMemberId(biz, cfg, client, transaction);
  if (!cfg.enabled || !memberId) return { slots: [], duration: cfg.duration, timezone: tz, memberId };

  const hours = workHoursOf(biz);
  const earliest = now.getTime() + cfg.lead_hours * 3600 * 1000;
  const horizonEnd = new Date(now.getTime() + (HORIZON_DAYS + 1) * 86400 * 1000);
  const busy = await busyIntervals(biz.id, memberId, now, horizonEnd, { transaction, excludeEventId });

  // 하루 상한 — 담당 멤버의 **예약**(대기·제안·확정)만 센다. 보통 회의는 상한이 아니라 겹침으로 막는다.
  const perDay = new Map();
  for (const [s, , ev] of busy) {
    if (!ev.booking_status || !ACTIVE.includes(ev.booking_status)) continue;
    const k = dayKey(partsIn(new Date(s), tz));
    perDay.set(k, (perDay.get(k) || 0) + 1);
  }

  const step = cfg.duration * 60000;
  const slots = [];
  const today = partsIn(now, tz);
  for (let i = 0; i <= HORIZON_DAYS; i += 1) {
    // 날짜 i 일 뒤 — 정오 기준으로 더해 서머타임 경계에서 날짜가 밀리지 않게 한다
    const noon = wallToUtc(today.y, today.m, today.d, 12 * 60, tz).getTime() + i * 86400000;
    const p = partsIn(new Date(noon), tz);
    const h = hours[p.dow];
    if (!h) continue;
    if ((perDay.get(dayKey(p)) || 0) >= cfg.daily_max) continue;
    for (let m = h[0]; m + cfg.duration <= h[1]; m += cfg.duration) {
      const start = wallToUtc(p.y, p.m, p.d, m, tz).getTime();
      if (start < earliest) continue;
      const end = start + step;
      if (busy.some(([bs, be]) => bs < end && be > start)) continue;
      slots.push(new Date(start).toISOString());
    }
  }
  return { slots, duration: cfg.duration, timezone: tz, memberId };
}

// ══════════════════════════════════════════════════════════════════════════
// 보조 — 표시 문자열 · .ics · 알림 · 메일
// ══════════════════════════════════════════════════════════════════════════
function whenText(ev, tz, locale) {
  const lc = locale === 'en' ? 'en-US' : 'ko-KR';
  const s = new Date(ev.start_at); const e = new Date(ev.end_at);
  const d = new Intl.DateTimeFormat(lc, { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(s);
  const t = new Intl.DateTimeFormat(lc, { timeZone: tz, timeStyle: 'short' }).format(e);
  return `${d} – ${t} (${tz})`;
}

function icsEscape(v) {
  return String(v || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
const icsTime = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** 확정 메일 첨부 — 고객 캘린더에 들어가야 예약이 끝난다(§4.5). UID 는 일정마다 고정(다시 받아도 한 건). */
function buildIcs(ev, { workspaceName, meetingUrl }) {
  const host = (process.env.APP_URL || 'https://planq.kr').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PlanQ//Booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:booking-${ev.id}@${host}`,
    `DTSTAMP:${icsTime(new Date())}`,
    `DTSTART:${icsTime(ev.start_at)}`,
    `DTEND:${icsTime(ev.end_at)}`,
    `SUMMARY:${icsEscape(workspaceName ? `${workspaceName} · ${ev.title}` : ev.title)}`,
    ...(meetingUrl ? [`LOCATION:${icsEscape(meetingUrl)}`, `URL:${icsEscape(meetingUrl)}`] : []),
    'STATUS:CONFIRMED',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/** 이 일정의 고객 참석자 행. 예약에는 **정확히 하나**다. */
async function clientAttendeeOf(eventId, transaction) {
  return CalendarEventAttendee.findOne({
    where: { event_id: eventId, client_id: { [Op.ne]: null } }, transaction,
  });
}

/** 이 예약의 메일을 **받을 링크** — 그 고객의 확인된 창구 개인 링크(가장 최근). 없으면 null.
 *  ★ 보내는 곳(mailGuest)과 확인창이 보여 주는 주소(guestRecipientOf)가 **같은 함수**를 쓴다 —
 *    확인창의 주소와 실제로 가는 주소가 다르면 확인이 거짓이 된다(CLAUDE.md «외부 발송은 확인을 받는다»). */
async function recipientLinkOf(ev) {
  const att = await clientAttendeeOf(ev.id);
  if (!att) return null;
  return GuestLink.findOne({
    where: {
      business_id: ev.business_id, client_id: att.client_id, kind: 'personal', scope: 'workspace',
      revoked_at: null, email_verified_at: { [Op.ne]: null }, contact_email: { [Op.ne]: null },
    },
    order: [['id', 'DESC']],
  });
}

/** 이 예약의 **받는 사람** — 한 곳에서 정한다(확인창 주소 = 실제 발송 주소).
 *  ① 그 고객의 확인된 창구 개인 링크(게스트) → 그 링크 주소로 «내 문의»
 *  ② 없으면 그 고객의 **계정**(P3 로그인 고객) → 계정 이메일 · 앱 «홈 › 내 문의»
 *  둘 다 없으면 null(메일 없음). 계정 쪽은 앱 알림도 같이 간다(notifyClientUser). */
async function recipientOf(ev) {
  const appUrl = process.env.APP_URL || 'https://dev.planq.kr';
  const link = await recipientLinkOf(ev);
  if (link) {
    const { personalTokenFor } = require('./guest_link');
    const token = personalTokenFor(link);
    if (token) {
      return { email: link.contact_email, openUrl: `${appUrl}/g/${token}?tab=mine`, locale: link.locale === 'en' ? 'en' : 'ko', via: 'guest' };
    }
  }
  const att = await clientAttendeeOf(ev.id);
  if (!att) return null;
  const client = await Client.findOne({ where: { id: att.client_id, business_id: ev.business_id }, attributes: ['id', 'user_id'] });
  if (!client || !client.user_id) return null;
  const { User } = require('../models');
  const u = await User.findByPk(client.user_id, { attributes: ['id', 'email', 'is_guest', 'language'] });
  if (!u || u.is_guest || !u.email) return null;
  return { email: u.email, openUrl: `${appUrl}/home?tab=mine`, locale: u.language === 'en' ? 'en' : 'ko', via: 'account', userId: u.id };
}

/** 팀 화면용 — 확인창에 적을 받는 주소. */
async function guestRecipientOf(user, businessId, eventId) {
  const ev = await loadTeamBooking(user, businessId, eventId);
  const r = await recipientOf(ev);
  return { email: r ? r.email : null };
}

/** 로그인 고객에게 **앱 알림** — 팀이 상태를 바꿨을 때만(고객 자신의 동작은 알릴 필요가 없다). */
async function notifyClientUser(ev, kind, { biz }) {
  try {
    const att = await clientAttendeeOf(ev.id);
    if (!att) return;
    const client = await Client.findOne({ where: { id: att.client_id, business_id: ev.business_id }, attributes: ['user_id'] });
    if (!client || !client.user_id) return;
    const { notify } = require('../routes/notifications');
    const tz = safeTz(biz.timezone || 'Asia/Seoul');
    await notify({
      userId: client.user_id, businessId: ev.business_id, eventKind: 'event',
      titleSpec: { feature: 'calendar', action: `booking_${kind}`, subject: ev.title },
      body: whenText(ev, tz, 'ko'),
      link: `${process.env.APP_URL || 'https://dev.planq.kr'}/home?tab=mine`,
      workspaceName: biz.brand_name || biz.name || null,
      entityType: 'calendar_event', entityId: ev.id,
      // ★ 메일은 빼고 앱·푸시만 (Fable FAIL D1). 메일은 바로 뒤 sendGuestBookingEmail 이 **한 통** 보낸다 —
      //   notify 의 메일 채널까지 태우면 팀 동작 한 번에 고객 메일이 두 통이고, 게스트 링크가 있으면
      //   확인창에 적은 주소가 아닌 **계정 주소로도** 나간다(«확인창 주소 = 실제 발송 주소» 위반).
      skipChannels: ['email'],
    });
  } catch (e) { console.warn('[booking] 고객 앱 알림 실패:', e.message); }
}

/** 고객에게 메일 — recipientOf 가 정한 곳으로. 없으면 조용히 건너뛴다(보낼 주소가 없다). */
async function mailGuest(ev, kind, { biz, byTeam = false }) {
  if (byTeam) await notifyClientUser(ev, kind, { biz });
  try {
    const to = await recipientOf(ev);
    if (!to) return false;
    const tz = safeTz(biz.timezone || 'Asia/Seoul');
    const locale = to.locale;
    const wsName = biz.brand_name || biz.name || null;
    const meetingUrl = kind === 'confirmed' ? ev.meeting_url : null;
    const { sendGuestBookingEmail } = require('./emailService');
    return await sendGuestBookingEmail({
      to: to.email, kind, workspaceName: wsName,
      whenText: whenText(ev, tz, locale),
      meetingUrl,
      openUrl: to.openUrl,
      ics: kind === 'confirmed' ? buildIcs(ev, { workspaceName: wsName, meetingUrl }) : null,
      businessId: ev.business_id, eventId: ev.id, locale,
    });
  } catch (e) {
    console.warn('[booking] 고객 메일 실패:', e.message);
    return false;
  }
}

async function notifyMember(ev, action, { biz, clientName }) {
  try {
    if (!ev.created_by) return;
    const { notifyMany } = require('../routes/notifications');
    const tz = safeTz(biz.timezone || 'Asia/Seoul');
    await notifyMany({
      userIds: [ev.created_by], businessId: ev.business_id, eventKind: 'event',
      titleSpec: { feature: 'calendar', action, subject: clientName || ev.title },
      body: `${ev.title} · ${whenText(ev, tz, 'ko')}`,
      link: `${process.env.APP_URL || 'https://dev.planq.kr'}/calendar?event=${ev.id}`,
      workspaceName: biz.brand_name || biz.name || null,
      entityType: 'calendar_event', entityId: ev.id,
    });
  } catch (e) { console.warn('[booking] 팀 알림 실패:', e.message); }
}

/** 실시간 — 캘린더·확인필요가 다시 읽게 한다. ★ 참석자만 보이는 일정이라 **id 만** 싣는다
 *  (워크스페이스 방 전체로 가는 소켓에 고객 이름·용건을 실으면 못 볼 사람의 개발자도구에 남는다). */
function broadcast(ev, kind = 'event:updated') {
  const io = global.__planqIo;
  if (!io) return;
  io.to(`business:${ev.business_id}`).emit(kind, { id: ev.id, business_id: ev.business_id });
  io.to(`business:${ev.business_id}`).emit('inbox:refresh', { business_id: ev.business_id });
}

function audit(ev, action, { userId = null, from = null, extra = {} } = {}) {
  createAuditLog({
    userId, businessId: ev.business_id,
    action, targetType: 'calendar_event', targetId: ev.id,
    oldValue: from ? { booking_status: from } : undefined,
    newValue: { booking_status: ev.booking_status, start_at: ev.start_at, ...extra },
  });
}

async function loadBiz(businessId, transaction) {
  return Business.findByPk(businessId, {
    attributes: ['id', 'name', 'brand_name', 'owner_id', 'timezone', 'work_hours', 'permissions',
      'default_language', 'guest_links_enabled', 'deleted_at'],
    transaction,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 고객(게스트) 쪽 — 신청 · 수락 · 다른 시간 · 취소
//   `ctx` 는 guest_common.attachGuest 가 푼 req.guest 다. **창구의 확인된 개인 링크**여야 한다.
// ══════════════════════════════════════════════════════════════════════════
function assertVerifiedEntryLink(ctx) {
  const link = ctx && ctx.link;
  const root = ctx && (ctx.parent || ctx.link);
  if (!link || !root || root.scope !== 'workspace') throw new BookingError('not_found', 404);
  // 확인 전에는 신청할 수 없다 — 시간을 잡아 놓고 연락할 길이 없으면 예약이 아니다(§1.5).
  if (link.kind !== 'personal' || !link.email_verified_at || !link.contact_email) {
    throw new BookingError('verify_required', 403);
  }
  return link;
}

/** 신원 — 게스트 링크 방문자. 판정은 assertVerifiedEntryLink 그대로. */
function guestActor(ctx) {
  const link = assertVerifiedEntryLink(ctx);
  return { kind: 'guest', businessId: link.business_id, client: ctx.client || null,
    email: link.contact_email, name: link.contact_name, link };
}

/** 신원 — 로그인 고객(P3). **이 워크스페이스의 고객 행이 자기 것**이어야 한다(Client.user_id = 나).
 *  ★ 멤버는 여기로 오지 않는다 — 멤버는 팀 쪽 문(teamApprove 등)을 쓴다. 고객 행이 없으면 403. */
async function accountActor(user, businessId) {
  if (!user || !businessId) throw new BookingError('forbidden', 403);
  const client = await Client.findOne({ where: { business_id: businessId, user_id: user.id } });
  if (!client || client.status === 'archived') throw new BookingError('forbidden', 403);
  const biz = await loadBiz(businessId);
  if (!biz || biz.deleted_at) throw new BookingError('not_found', 404);
  return { kind: 'account', businessId, client, email: user.email || null,
    name: client.display_name || client.company_name || null, link: null, userId: user.id };
}

async function slotsForActor(actor) {
  const biz = await loadBiz(actor.businessId);
  if (!biz) throw new BookingError('not_found', 404);
  const cfg = bookingOf(biz);
  if (!cfg.enabled) return { enabled: false, slots: [], duration: cfg.duration, timezone: safeTz(biz.timezone) };
  const r = await computeSlots(biz, { client: actor.client });
  return { enabled: true, slots: r.slots, duration: r.duration, timezone: r.timezone };
}

async function slotsForGuest(ctx) {
  const root = ctx && (ctx.parent || ctx.link);
  if (!root || root.scope !== 'workspace') throw new BookingError('not_found', 404);
  const biz = await loadBiz(root.business_id);
  if (!biz) throw new BookingError('not_found', 404);
  const cfg = bookingOf(biz);
  if (!cfg.enabled) return { enabled: false, slots: [], duration: cfg.duration, timezone: safeTz(biz.timezone) };
  // 개인 링크(확인 후)만 슬롯을 본다 — 공유 링크는 «비어 있음» 을 열거하는 창구가 될 수 있다(§5 P2 «개인 링크 필수»).
  assertVerifiedEntryLink(ctx);
  const client = ctx.client || null;
  const r = await computeSlots(biz, { client });
  return { enabled: true, slots: r.slots, duration: r.duration, timezone: r.timezone };
}

/**
 * 신청. 없으면 문의 고객(prospect)을 만든다 — `add_prospect` 한도와 «같은 이메일이면 잇기» 는
 * 고객으로 저장(routes/sale_save.js)과 **같은 함수**다.
 */
async function requestForActor(actor, { start, purpose, memo }) {
  const link = actor.link;   // 게스트만 있다 — 계정 고객은 null
  if (!PURPOSES.includes(purpose)) throw new BookingError('invalid_purpose');
  const memoText = typeof memo === 'string' ? memo.trim().slice(0, MEMO_MAX) : '';
  const startDate = new Date(String(start || ''));
  if (Number.isNaN(startDate.getTime())) throw new BookingError('invalid_start');
  const startIso = startDate.toISOString();

  const bizPre = await loadBiz(actor.businessId);
  if (!bizPre || bizPre.deleted_at) throw new BookingError('not_found', 404);
  if (!bookingOf(bizPre).enabled) throw new BookingError('booking_disabled', 409);

  // 고객 행 — 링크에 붙어 있으면 그것, 아니면 같은 이메일, 그래도 없으면 새 문의 고객.
  const { findExistingByContact } = require('./saleCommon');
  let client = actor.client || null;
  if (!client && actor.email) client = await findExistingByContact(actor.businessId, { email: actor.email });
  let createdClient = false;
  if (!client) {
    const planEngine = require('./plan');
    const can = await planEngine.can(actor.businessId, 'add_prospect');
    if (!can.ok) {
      const err = new BookingError('prospect_limit', 422);
      err.quota = planEngine.buildQuotaError(can, actor.businessId);
      throw err;
    }
  }

  // 대기 중 신청 상한 — 한 사람이 달력을 채우지 못하게
  if (client) {
    const open = await CalendarEvent.count({
      where: { business_id: actor.businessId, booking_status: { [Op.in]: ['requested', 'proposed'] } },
      include: [{ model: CalendarEventAttendee, as: 'attendees', required: true, where: { client_id: client.id } }],
      distinct: true,
    });
    if (open >= MAX_OPEN_PER_CLIENT) throw new BookingError('too_many_open', 429);
  }

  const t = await sequelize.transaction();
  let ev;
  try {
    // ★ 워크스페이스 행을 잠근다 — 같은 슬롯에 두 사람이 동시에 신청하면 둘 다 «비어 있음» 을 본다.
    //   잠근 뒤 **다시** 계산해 그 슬롯이 아직 있는지 확인한다(검사와 쓰기 사이의 틈을 닫는다).
    const biz = await Business.findByPk(actor.businessId, {
      attributes: ['id', 'name', 'brand_name', 'owner_id', 'timezone', 'work_hours', 'permissions', 'default_language'],
      transaction: t, lock: t.LOCK.UPDATE,
    });
    const cfg = bookingOf(biz);
    const { slots, memberId } = await computeSlots(biz, { client, transaction: t });
    if (!memberId) throw new BookingError('booking_disabled', 409);
    if (!slots.includes(startIso)) throw new BookingError('slot_unavailable', 409);

    if (!client) {
      client = await Client.create({
        business_id: biz.id,
        display_name: (actor.name || '').trim().slice(0, 100) || String(actor.email || '').split('@')[0],
        invite_email: actor.email,
        kind: 'customer',
        status: 'prospect',
        sales_source: 'guest_link',
        assigned_member_id: memberId,
        last_touch_at: new Date(),
      }, { transaction: t });
      createdClient = true;
    }

    const lang = biz.default_language === 'en' ? 'en' : 'ko';
    const who = client.display_name || client.company_name || actor.name || actor.email;
    ev = await CalendarEvent.create({
      business_id: biz.id,
      title: `${PURPOSE_LABEL[lang][purpose]} · ${who}`.slice(0, 300),
      description: memoText || null,
      start_at: startDate,
      end_at: new Date(startDate.getTime() + cfg.duration * 60000),
      all_day: false,
      category: 'meeting',
      vlevel: 'L1',                 // 참석자만(담당 멤버 + 고객) — 파일 머리말
      created_by: memberId,
      created_via: 'booking',
      booking_status: 'requested',
      // 확정 전에는 알림·구글 동기화를 켜지 않는다 — 안 정해진 일정이 누구의 캘린더에도 먼저 들어가면 안 된다
      reminder_minutes: null,
      gcal_sync_workspace: false,
      gcal_sync_personal: false,
    }, { transaction: t });
    await CalendarEventAttendee.bulkCreate([
      // 담당 멤버는 «수락» 으로 둔다 — pending 이면 확인필요의 «참석 응답» 에도 떠서 한 건이 두 번 센다
      { event_id: ev.id, user_id: memberId, response: 'accepted', responded_at: new Date() },
      { event_id: ev.id, client_id: client.id, response: 'accepted', responded_at: new Date() },
    ], { transaction: t });

    // 연결 — 링크와 방문자 대화방이 이 고객을 가리키게(비어 있을 때만. 사람이 건 연결을 덮지 않는다).
    //   ★ 부모(공유 창구 링크)에는 **붙이지 않는다** — 창구는 워크스페이스의 얼굴이고, 붙이면
    //     그 창구로 들어오는 모두가 이 고객이 된다(routes/sale_save.js 의 부모 연결과 다른 이유).
    if (link && !link.client_id) await link.update({ client_id: client.id }, { transaction: t });
    if (link && link.conversation_id) {
      await Conversation.update({ client_id: client.id },
        { where: { id: link.conversation_id, business_id: biz.id, client_id: null }, transaction: t });
    }
    await t.commit();
  } catch (e) {
    if (!t.finished) await t.rollback();
    throw e;
  }

  const biz = await loadBiz(actor.businessId);
  if (createdClient) {
    try { require('./plan').invalidateBusinessCache(biz.id); } catch { /* 캐시일 뿐이다 */ }
  }
  // 영업 단계 — 아직 영업 밖이면 «문의» 로(자동은 올리기만 한다 — salesStage 규칙)
  try {
    const { setStage } = require('./salesStage');
    await setStage(client, 'inquiry', { origin: 'auto', reason: '상담 예약 신청', sourceRef: { calendar_event_id: ev.id } });
  } catch (e) { console.warn('[booking] 단계 전이 실패:', e.message); }
  audit(ev, 'booking.request', { userId: actor.userId || null, extra: { client_id: client.id, created_client: createdClient, by: actor.kind } });
  broadcast(ev, 'event:created');
  if (createdClient && global.__planqIo) {
    global.__planqIo.to(`business:${biz.id}`).emit('client:new', { id: client.id, business_id: biz.id });
  }
  await notifyMember(ev, 'booking_request', { biz, clientName: client.display_name });
  await mailGuest(ev, 'requested', { biz });
  return ev;
}

/** 이 고객의 예약 한 건 — 남의 것은 없는 것으로 친다. 축은 **client_id** 다
 *  (게스트 링크든 로그인 계정이든 같은 고객이면 같은 건이 보인다 — §4.4). */
function actorClientId(actor) {
  if (actor.link) return actor.link.client_id || null;
  return actor.client ? actor.client.id : null;
}
async function findActorBooking(actor, eventId, transaction) {
  const cid = actorClientId(actor);
  if (!cid) throw new BookingError('not_found', 404);
  const ev = await CalendarEvent.findOne({
    where: { id: Number(eventId) || 0, business_id: actor.businessId, booking_status: { [Op.ne]: null } },
    include: [{ model: CalendarEventAttendee, as: 'attendees', required: true, where: { client_id: cid } }],
    transaction,
  });
  if (!ev) throw new BookingError('not_found', 404);
  return ev;
}

async function listActorBookings(actor) {
  const cid = actorClientId(actor);
  if (!cid) return [];
  const rows = await CalendarEvent.findAll({
    where: { business_id: actor.businessId, booking_status: { [Op.ne]: null } },
    include: [{ model: CalendarEventAttendee, as: 'attendees', required: true, where: { client_id: cid }, attributes: [] }],
    attributes: ['id', 'title', 'start_at', 'end_at', 'booking_status', 'meeting_url'],
    order: [['start_at', 'DESC']],
    limit: 50,
  });
  const now = Date.now();
  // ★ 화이트리스트 — 무인증 표면이다. 설명(메모)·담당자·참석자 목록은 싣지 않는다.
  return rows.map((ev) => {
    const done = ev.booking_status === 'confirmed' && new Date(ev.end_at).getTime() < now;
    return {
      id: ev.id,
      title: ev.title,
      start_at: ev.start_at,
      end_at: ev.end_at,
      status: done ? 'done' : ev.booking_status,
      meeting_url: ev.booking_status === 'confirmed' ? (ev.meeting_url || null) : null,
    };
  });
}

async function acceptForActor(actor, eventId) {
  const ev = await findActorBooking(actor, eventId);
  if (ev.booking_status !== 'proposed') throw new BookingError('invalid_state', 409);
  if (new Date(ev.start_at).getTime() <= Date.now()) throw new BookingError('past', 409);
  return confirmInternal(ev, { actorUserId: actor.userId || null, via: actor.kind });
}

async function cancelForActor(actor, eventId) {
  const ev = await findActorBooking(actor, eventId);
  if (!ACTIVE.includes(ev.booking_status)) throw new BookingError('invalid_state', 409);
  if (new Date(ev.end_at).getTime() <= Date.now()) throw new BookingError('past', 409);
  const from = ev.booking_status;
  await ev.update({ booking_status: 'canceled', reminder_minutes: null });
  const biz = await loadBiz(ev.business_id);
  audit(ev, 'booking.cancel', { userId: actor.userId || null, from, extra: { by: actor.kind } });
  broadcast(ev);
  await notifyMember(ev, 'booking_canceled', { biz });
  await mailGuest(ev, 'canceled', { biz });
  await syncGoogle(ev);
  return ev;
}

/** 제안받은 시간 대신 다른 시간 — 다시 «신청» 이 된다(§4.6). 슬롯 검사는 신청과 같다. */
async function rescheduleForActor(actor, eventId, { start }) {
  const startDate = new Date(String(start || ''));
  if (Number.isNaN(startDate.getTime())) throw new BookingError('invalid_start');
  const t = await sequelize.transaction();
  let ev; let from;
  try {
    ev = await findActorBooking(actor, eventId, t);
    if (!['requested', 'proposed'].includes(ev.booking_status)) throw new BookingError('invalid_state', 409);
    const biz = await Business.findByPk(ev.business_id, {
      attributes: ['id', 'owner_id', 'timezone', 'work_hours', 'permissions'], transaction: t, lock: t.LOCK.UPDATE,
    });
    const cfg = bookingOf(biz);
    if (!cfg.enabled) throw new BookingError('booking_disabled', 409);
    // 자기 자신은 막는 일정에서 뺀다 — 안 빼면 제안받은 그 시간이 «이미 찼음» 이 된다
    const { slots } = await computeSlots(biz, { client: actor.client, transaction: t, excludeEventId: ev.id });
    if (!slots.includes(startDate.toISOString())) throw new BookingError('slot_unavailable', 409);
    from = ev.booking_status;
    await ev.update({
      booking_status: 'requested', start_at: startDate,
      end_at: new Date(startDate.getTime() + cfg.duration * 60000),
    }, { transaction: t });
    await t.commit();
  } catch (e) {
    if (!t.finished) await t.rollback();
    throw e;
  }
  const biz = await loadBiz(ev.business_id);
  audit(ev, 'booking.reschedule', { userId: actor.userId || null, from, extra: { by: actor.kind } });
  broadcast(ev);
  await notifyMember(ev, 'booking_request', { biz });
  await mailGuest(ev, 'requested', { biz });
  return ev;
}

// 게스트 링크 입구 — 판정(창구 확인된 개인 링크)을 지난 뒤 같은 함수로.
const requestBooking = (ctx, body) => requestForActor(guestActor(ctx), body);
const listGuestBookings = async (ctx) => listActorBookings(guestActor(ctx));
const guestAccept = (ctx, id) => acceptForActor(guestActor(ctx), id);
const guestCancel = (ctx, id) => cancelForActor(guestActor(ctx), id);
const guestReschedule = (ctx, id, body) => rescheduleForActor(guestActor(ctx), id, body);

// ══════════════════════════════════════════════════════════════════════════
// 팀 쪽 — 승인 · 다른 시간 제안 · 거절 · 취소
//   누가 할 수 있나: 담당 멤버(= 만든 사람) · 오너 · 관리자. 판정은 이 함수 하나.
// ══════════════════════════════════════════════════════════════════════════
async function loadTeamBooking(user, businessId, eventId) {
  const { getUserScope } = require('../middleware/access_scope');
  const scope = await getUserScope(user.id, businessId, user.platform_role);
  if (!scope || scope.isClient || !(scope.isMember || scope.isOwner || scope.isAdmin || scope.isPlatformAdmin)) {
    throw new BookingError('forbidden', 403);
  }
  const ev = await CalendarEvent.findOne({
    where: { id: Number(eventId) || 0, business_id: businessId, booking_status: { [Op.ne]: null } },
  });
  if (!ev) throw new BookingError('not_found', 404);
  const manager = scope.isOwner || scope.isAdmin || scope.isPlatformAdmin;
  if (!manager && ev.created_by !== user.id) throw new BookingError('forbidden', 403);
  return ev;
}

async function syncGoogle(ev) {
  try {
    const calendarSync = require('./calendarSync');
    await calendarSync.reconcile(ev, { businessId: ev.business_id, userId: ev.created_by });
  } catch (e) { console.warn('[booking] 구글 동기화 실패:', e.message); }
}

async function confirmInternal(ev, { actorUserId, via, createMeeting = false }) {
  const from = ev.booking_status;
  let meetWarning = null;
  let meetingUrl = ev.meeting_url || null;
  let meetGcalId = null;
  let meetSource = null;
  if (createMeeting && !meetingUrl) {
    // ★ 담당 멤버 **본인** 연동으로만 만든다(파일 머리말 — 워크스페이스 토큰은 오너 캘린더다).
    const calendarSync = require('./calendarSync');
    const src = await calendarSync.resolveMeetSource({ businessId: ev.business_id, userId: ev.created_by });
    if (src.kind !== 'personal') {
      meetWarning = src.kind === 'workspace' ? 'meet_needs_personal_calendar' : (src.reason || 'gcal_not_connected');
    } else {
      try {
        const m = await calendarSync.createMeeting(src, {
          title: ev.title, summary: ev.title, description: null, location: null,
          startAt: ev.start_at, endAt: ev.end_at, rrule: null,
        });
        if (m && m.meetUrl) { meetingUrl = m.meetUrl; meetGcalId = m.id || null; meetSource = src; }
      } catch (e) {
        await calendarSync.recordMeetError(src, e).catch(() => null);
        meetWarning = 'gcal_meeting_create_failed';
      }
    }
  }
  await ev.update({
    booking_status: 'confirmed',
    reminder_minutes: 1440,
    gcal_sync_personal: true,
    meeting_url: meetingUrl,
    meeting_provider: meetingUrl && meetGcalId ? 'google_meet' : ev.meeting_provider,
  });
  if (meetSource && meetGcalId) {
    try { await require('./calendarSync').linkMeeting(ev.id, meetSource, meetGcalId, ev.business_id); } catch (e) { console.warn('[booking] linkMeeting', e.message); }
  }
  await syncGoogle(ev);
  const biz = await loadBiz(ev.business_id);
  const att = await clientAttendeeOf(ev.id);
  if (att) {
    const client = await Client.findOne({ where: { id: att.client_id, business_id: ev.business_id } });
    if (client) {
      try {
        const { setStage } = require('./salesStage');
        await setStage(client, 'consulting', { origin: 'auto', reason: '상담 확정', sourceRef: { calendar_event_id: ev.id } });
      } catch (e) { console.warn('[booking] 단계 전이 실패:', e.message); }
    }
  }
  audit(ev, 'booking.confirm', { userId: actorUserId, from, extra: { by: via } });
  broadcast(ev);
  // 고객이 수락했으면(게스트든 계정이든) 담당에게 알린다 — 전에 `via === 'guest'` 라 **계정 고객 수락은
  //   아무에게도 안 알려졌다**(Fable FAIL D2). «같은 함수, 신원만 다르다» 가 이 줄에서 깨졌던 것이다.
  if (via !== 'team') await notifyMember(ev, 'booking_accepted', { biz });
  await mailGuest(ev, 'confirmed', { biz, byTeam: via === 'team' });
  return { ev, meetWarning };
}

async function teamApprove(user, businessId, eventId, { createMeeting = false } = {}) {
  const ev = await loadTeamBooking(user, businessId, eventId);
  if (ev.booking_status !== 'requested') throw new BookingError('invalid_state', 409);
  if (new Date(ev.start_at).getTime() <= Date.now()) throw new BookingError('past', 409);
  return confirmInternal(ev, { actorUserId: user.id, via: 'team', createMeeting: !!createMeeting });
}

async function teamPropose(user, businessId, eventId, { start }) {
  const ev = await loadTeamBooking(user, businessId, eventId);
  if (!['requested', 'proposed'].includes(ev.booking_status)) throw new BookingError('invalid_state', 409);
  const startDate = new Date(String(start || ''));
  if (Number.isNaN(startDate.getTime())) throw new BookingError('invalid_start');
  // 팀은 근무시간 밖도 제안할 수 있다(사람의 판단). 과거만 막는다.
  if (startDate.getTime() <= Date.now()) throw new BookingError('past', 409);
  const len = new Date(ev.end_at).getTime() - new Date(ev.start_at).getTime();
  const from = ev.booking_status;
  await ev.update({ booking_status: 'proposed', start_at: startDate, end_at: new Date(startDate.getTime() + len) });
  const biz = await loadBiz(ev.business_id);
  audit(ev, 'booking.propose', { userId: user.id, from });
  broadcast(ev);
  await mailGuest(ev, 'proposed', { biz, byTeam: true });
  return { ev };
}

async function teamDecline(user, businessId, eventId) {
  const ev = await loadTeamBooking(user, businessId, eventId);
  if (!['requested', 'proposed'].includes(ev.booking_status)) throw new BookingError('invalid_state', 409);
  const from = ev.booking_status;
  await ev.update({ booking_status: 'declined', reminder_minutes: null });
  const biz = await loadBiz(ev.business_id);
  audit(ev, 'booking.decline', { userId: user.id, from });
  broadcast(ev);
  await mailGuest(ev, 'declined', { biz, byTeam: true });
  return { ev };
}

async function teamCancel(user, businessId, eventId) {
  const ev = await loadTeamBooking(user, businessId, eventId);
  if (ev.booking_status !== 'confirmed') throw new BookingError('invalid_state', 409);
  if (new Date(ev.end_at).getTime() <= Date.now()) throw new BookingError('past', 409);
  await ev.update({ booking_status: 'canceled', reminder_minutes: null });
  const biz = await loadBiz(ev.business_id);
  audit(ev, 'booking.cancel', { userId: user.id, from: 'confirmed', extra: { by: 'team' } });
  broadcast(ev);
  await mailGuest(ev, 'canceled', { biz, byTeam: true });
  await syncGoogle(ev);
  return { ev };
}

// ══════════════════════════════════════════════════════════════════════════
// 끝남 → 상담 원장 1행 (cron). 멱등 — calendar_event_id 로 이미 있는지 본다.
// ══════════════════════════════════════════════════════════════════════════
async function recordFinishedBookings(now = new Date()) {
  const rows = await CalendarEvent.findAll({
    where: {
      booking_status: 'confirmed',
      end_at: { [Op.lt]: now, [Op.gt]: new Date(now.getTime() - 30 * 86400000) },
    },
    attributes: ['id', 'business_id', 'title', 'start_at', 'end_at', 'created_by'],
    limit: 500,
  });
  let made = 0;
  for (const ev of rows) {
    try {
      const exists = await ClientInteraction.findOne({ where: { calendar_event_id: ev.id }, attributes: ['id'] });
      if (exists) continue;
      const att = await clientAttendeeOf(ev.id);
      if (!att) continue;
      const client = await Client.findOne({ where: { id: att.client_id, business_id: ev.business_id } });
      if (!client) continue;
      await ClientInteraction.create({
        business_id: ev.business_id,
        client_id: client.id,
        calendar_event_id: ev.id,
        kind: 'meeting',
        occurred_at: ev.start_at,
        duration_seconds: Math.max(0, Math.round((new Date(ev.end_at) - new Date(ev.start_at)) / 1000)),
        title: String(ev.title || '').slice(0, 200),
        origin: 'auto',
        source_kind: 'calendar',
        created_by: ev.created_by,
      });
      made += 1;
      try {
        const { touchClient } = require('./saleCommon');
        await touchClient(client, ev.start_at);
      } catch { /* 접점 시각은 보조다 */ }
    } catch (e) { console.warn('[booking] 끝남 기록 실패:', ev.id, e.message); }
  }
  return made;
}

function initBookingCron() {
  const cron = require('node-cron');
  cron.schedule('*/15 * * * *', () => {
    recordFinishedBookings().catch((e) => console.warn('[bookingCron]', e.message));
  });
  console.log('[bookingCron] initialized — runs every 15 minutes');
}

module.exports = {
  BookingError, PURPOSES, BOOKING_DEFAULTS,
  normalizeBooking, bookingOf, normalizeWorkHours, serializeWorkHours, workHoursOf,
  computeSlots, slotsForGuest, requestBooking, listGuestBookings, guestAccept, guestCancel, guestReschedule,
  accountActor, slotsForActor, requestForActor, listActorBookings, acceptForActor, cancelForActor, rescheduleForActor,
  teamApprove, teamPropose, teamDecline, teamCancel, guestRecipientOf,
  recordFinishedBookings, initBookingCron, buildIcs,
  // 테스트용
  _wallToUtc: wallToUtc, _partsIn: partsIn,
};
