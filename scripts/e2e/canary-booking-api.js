// scripts/e2e/canary-booking-api.js — 상담 예약(CLIENT_ENTRY P2) **서버 판정** 실 HTTP 검사 (화면 없음)
//
//   슬롯 응답 모양(키 4개·일정 정보 0) · 공유/옛 링크 차단 · 근무시간 밖·중복 슬롯 거절 · 같은 이메일 = 고객 1행 ·
//   하루 상한 · 대기 3건 상한 · 확인필요 한 건 = 한 버킷 · 승인/제안/수락/거절/취소 전이 · 메일 시도 기록 ·
//   .ics 모양 · 다른 방문자 차단 · 끝남 cron 멱등 · 받는 주소 = 발송 주소 · 일반 수정/삭제 409 · 끄면 409.
//   화면 쪽은 `--suite booking` 이 잰다. 둘 다 CREDS 계정의 워크스페이스에서 돌고 **스스로 원복**한다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const crypto = require('crypto');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const { CREDS } = require('./lib/browser');
const B = process.env.E2E_API || 'http://localhost:3003';
let BIZ = null;
let results = [];
const push = (name, ok, detail = '') => { results.push({ name, fail: ok ? 0 : 1, details: [String(detail ?? '')] }); };
const q = async (sql, rep) => (await sequelize.query(sql, { replacements: rep }))[0];

let tok;
async function api(path, init = {}) {
  const r = await fetch(B + path, { ...init, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(init.headers || {}) } });
  const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body, text };
}
async function pub(path, init = {}) {
  const r = await fetch(B + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body, text };
}

const cleanup = { links: [], entryIssued: null, emails: [], permsBefore: null, whBefore: undefined };

async function visitor(entryToken, tag) {
  const mail = `bk-${tag}-${Date.now()}@example.com`;
  cleanup.emails.push(mail);
  await pub(`/api/guest/${entryToken}/notify/request`, { method: 'POST', body: JSON.stringify({ name: `예약${tag}`, email: mail, consent: true, locale: 'ko' }) });
  const kid = await q('SELECT id FROM guest_links WHERE contact_email=? ORDER BY id DESC LIMIT 1', [mail]);
  if (!kid.length) throw new Error('personal link not created');
  cleanup.links.push(kid[0].id);
  const code = '246802';
  await q('UPDATE guest_links SET otp_hash=?, otp_expires_at=DATE_ADD(NOW(), INTERVAL 5 MINUTE), otp_attempts=0, otp_locked_until=NULL WHERE id=?',
    [crypto.createHash('sha256').update(code).digest('hex'), kid[0].id]);
  const v = await pub(`/api/guest/${entryToken}/notify/verify`, { method: 'POST', body: JSON.stringify({ email: mail, code }) });
  return { mail, id: kid[0].id, ptok: v.body?.data?.personal_token };
}

async function run() {
  results = [];
  cleanup.links = []; cleanup.emails = []; cleanup.entryIssued = null; cleanup.convIssued = null;
  try {
    const lr = await pub('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: CREDS.email, password: CREDS.password }) });
    tok = lr.body.data.token || lr.body.data.accessToken;
    const meR = await api('/api/auth/me');
    BIZ = meR.body?.data?.active_business_id ?? meR.body?.data?.user?.active_business_id ?? null;
    if (!BIZ) { push('예약 API 픽스처', false, '워크스페이스 없음'); return results; }
    const [bz] = await q('SELECT permissions, work_hours, owner_id, timezone FROM businesses WHERE id=?', [BIZ]);
    cleanup.permsBefore = bz.permissions; cleanup.whBefore = bz.work_hours;

    // ── 설정
    const pre = await api(`/api/businesses/${BIZ}/customer-entry`);
    const introBefore = pre.body.data.customer_entry.intro;
    const put = await api(`/api/businesses/${BIZ}/customer-entry`, { method: 'PUT', body: JSON.stringify({ booking: { enabled: true, duration: 30, lead_hours: 0, daily_max: 2 } }) });
    push('설정: 예약 켜기 PUT 200', put.status === 200, String(put.status));
    push('설정: 예약만 보내도 소개는 그대로 (병합)', put.body?.data?.customer_entry?.intro === introBefore, JSON.stringify(put.body?.data?.customer_entry?.intro)?.slice(0, 40));
    const put2 = await api(`/api/businesses/${BIZ}/customer-entry`, { method: 'PUT', body: JSON.stringify({ intro: introBefore }) });
    push('설정: 소개만 보내도 예약 설정은 그대로', put2.body?.data?.customer_entry?.booking?.enabled === true && put2.body.data.customer_entry.booking.daily_max === 2, JSON.stringify(put2.body?.data?.customer_entry?.booking));
    const bad = await api(`/api/businesses/${BIZ}/customer-entry`, { method: 'PUT', body: JSON.stringify({ booking: { member_id: 999999 } }) });
    push('설정: 남의/없는 담당 멤버 400', bad.status === 400, String(bad.status));
    const whBad = await api(`/api/businesses/${BIZ}/settings`, { method: 'PUT', body: JSON.stringify({ work_hours: { mon: 'x' } }) });
    push('근무시간: 이상한 모양 400', whBad.status === 400, String(whBad.status));

    // ── 창구 링크
    const li = await api(`/api/businesses/${BIZ}/customer-entry/link`, { method: 'POST', body: '{}' });
    if (li.status === 201) cleanup.entryIssued = li.body.data.id;
    const entry = li.body.data.url.split('/g/')[1];
    const ctx = await pub(`/api/guest/${entry}`);
    push('창구 ctx: entry.booking = {enabled, duration_minutes} 두 키만', JSON.stringify(Object.keys(ctx.body.data.entry.booking).sort()) === '["duration_minutes","enabled"]' && ctx.body.data.entry.booking.enabled === true, JSON.stringify(ctx.body.data.entry.booking));

    const shSlots = await pub(`/api/guest/${entry}/booking/slots`);
    push('공유 창구 링크로 슬롯 403 (개인 링크 필수)', shSlots.status === 403, String(shSlots.status));
    const shReq = await pub(`/api/guest/${entry}/booking`, { method: 'POST', body: JSON.stringify({ start: new Date().toISOString(), purpose: 'quote' }) });
    push('공유 창구 링크로 신청 403', shReq.status === 403, String(shReq.status));

    // 옛 대화방 링크 → 404
    const { GuestLink } = require('/opt/planq/dev-backend/models');
    const { urlForSharedLink } = require('/opt/planq/dev-backend/services/guest_link');
    const convLinks = await GuestLink.findAll({ where: { scope: 'conversation', kind: 'shared', revoked_at: null }, limit: 20 });
    let convUrl = convLinks.map(urlForSharedLink).find(Boolean);
    if (!convUrl) {
      // 파생 토큰 링크가 없으면 고객 대화방에 하나 발급한다(정리 목록에 넣는다)
      // 살아 있는 링크가 **없는** 방을 고른다 — 있는 방에 발급하면 그 링크를 재사용하고(옛 난수 토큰이면 주소 null),
      //   교체(replace)는 남이 쓰는 링크를 죽인다.
      const [cv] = await q("SELECT c.id FROM conversations c WHERE c.business_id=? AND c.channel_type='customer' AND c.status='active' AND NOT EXISTS (SELECT 1 FROM guest_links g WHERE g.conversation_id=c.id AND g.kind='shared' AND g.revoked_at IS NULL) LIMIT 1", [BIZ]);
      if (cv) {
        const { issueOrReuseSharedLink } = require('/opt/planq/dev-backend/services/guest_link');
        const r = await issueOrReuseSharedLink({ businessId: BIZ, scope: 'conversation', conversationId: cv.id, createdBy: bz.owner_id, canWrite: true });
        if (!r.reused) cleanup.convIssued = r.link.id;
        convUrl = r.url;
      }
    }
    if (convUrl) {
      const cs = await pub(`/api/guest/${convUrl.split('/g/')[1]}/booking/slots`);
      push('옛 대화방 링크로 슬롯 404', cs.status === 404, String(cs.status));
    } else push('옛 대화방 링크로 슬롯 404', false, '미측정 — 파생 토큰 링크 없음');

    // ── 방문자 A
    const A = await visitor(entry, 'a');
    push('방문자 A 확인 → 개인 토큰', !!A.ptok);
    const sl = await pub(`/api/guest/${A.ptok}/booking/slots`);
    const keys = Object.keys(sl.body?.data || {}).sort().join(',');
    push('슬롯 200 · 키 4개(enabled,slots,duration_minutes,timezone)', sl.status === 200 && keys === 'duration_minutes,enabled,slots,timezone', `${sl.status} ${keys}`);
    const slots = sl.body.data.slots;
    push('슬롯은 ISO 문자열 배열이고 1개 이상', Array.isArray(slots) && slots.length > 0 && slots.every((x) => typeof x === 'string' && /Z$/.test(x)), `n=${slots.length}`);
    const leak = ['title', 'created_by', 'attendee', '@', 'business_id', 'user_id'].filter((w) => sl.text.includes(w));
    push('슬롯 응답 원문에 일정 정보 0', leak.length === 0, leak.join(','));

    // 근무시간 밖(워크스페이스 시간대 새벽 3시)
    const { _wallToUtc, _partsIn } = require('/opt/planq/dev-backend/services/booking');
    const tomorrow = new Date(Date.now() + 2 * 86400000);
    const p = _partsIn(tomorrow, bz.timezone || 'Asia/Seoul');
    const night = _wallToUtc(p.y, p.m, p.d, 3 * 60, bz.timezone || 'Asia/Seoul').toISOString();
    const rNight = await pub(`/api/guest/${A.ptok}/booking`, { method: 'POST', body: JSON.stringify({ start: night, purpose: 'quote' }) });
    push('근무시간 밖 신청 거절(409 slot_unavailable)', rNight.status === 409 && rNight.body?.message === 'slot_unavailable', `${rNight.status} ${rNight.body?.message}`);
    const rPurpose = await pub(`/api/guest/${A.ptok}/booking`, { method: 'POST', body: JSON.stringify({ start: slots[0], purpose: 'hack' }) });
    push('모르는 용건 400', rPurpose.status === 400, String(rPurpose.status));

    const r1 = await pub(`/api/guest/${A.ptok}/booking`, { method: 'POST', body: JSON.stringify({ start: slots[0], purpose: 'quote', memo: '메모 테스트' }) });
    push('신청 1 → 201', r1.status === 201, `${r1.status} ${r1.body?.message}`);
    const ev1 = r1.body?.data?.id;
    const [row1] = await q('SELECT booking_status, vlevel, created_by, gcal_sync_workspace, gcal_sync_personal, reminder_minutes, created_via FROM calendar_events WHERE id=?', [ev1]);
    push('일정: requested · L1 · 오너가 만든 사람 · 구글/알림 꺼짐', row1 && row1.booking_status === 'requested' && row1.vlevel === 'L1' && row1.created_by === bz.owner_id && !row1.gcal_sync_workspace && !row1.gcal_sync_personal && row1.reminder_minutes === null && row1.created_via === 'booking', JSON.stringify(row1));
    const cl = await q("SELECT id, status, sales_stage, sales_source FROM clients WHERE business_id=? AND invite_email=?", [BIZ, A.mail]);
    push('문의 고객 1행 생성 · prospect · inquiry', cl.length === 1 && cl[0].status === 'prospect' && cl[0].sales_stage === 'inquiry' && cl[0].sales_source === 'guest_link', JSON.stringify(cl));
    const clientA = cl[0]?.id;
    const atts = await q('SELECT user_id, client_id, response FROM calendar_event_attendees WHERE event_id=?', [ev1]);
    push('참석자 2 (담당 멤버 수락 + 고객)', atts.length === 2 && atts.some((a) => a.user_id === bz.owner_id && a.response === 'accepted') && atts.some((a) => a.client_id === clientA), JSON.stringify(atts));
    const [lnk] = await q('SELECT client_id, parent_link_id, conversation_id FROM guest_links WHERE id=?', [A.id]);
    const [par] = await q('SELECT client_id FROM guest_links WHERE id=?', [lnk.parent_link_id]);
    push('개인 링크에만 고객 연결 · 공유 창구에는 안 붙음', lnk.client_id === clientA && par.client_id === null, `personal=${lnk.client_id} shared=${par.client_id}`);
    const [room] = await q('SELECT client_id FROM conversations WHERE id=?', [lnk.conversation_id]);
    push('방문자 대화방도 그 고객으로 연결', room && room.client_id === clientA, JSON.stringify(room));

    const again = await pub(`/api/guest/${A.ptok}/booking`, { method: 'POST', body: JSON.stringify({ start: slots[0], purpose: 'quote' }) });
    push('같은 슬롯 두 번 → 409', again.status === 409, `${again.status} ${again.body?.message}`);

    const sl2 = (await pub(`/api/guest/${A.ptok}/booking/slots`)).body.data.slots;
    push('잡힌 슬롯은 목록에서 빠진다', !sl2.includes(slots[0]), `before=${slots.length} after=${sl2.length}`);
    const r2 = await pub(`/api/guest/${A.ptok}/booking`, { method: 'POST', body: JSON.stringify({ start: sl2[0], purpose: 'new_project' }) });
    push('신청 2 → 201 · 같은 이메일이라 고객 추가 0', r2.status === 201 && (await q('SELECT COUNT(*) n FROM clients WHERE business_id=? AND invite_email=?', [BIZ, A.mail]))[0].n == 1, String(r2.status));
    const ev2 = r2.body?.data?.id;
    // 하루 상한 2 — ev1·ev2 가 같은 날이면 그 날은 통째로 빠진다
    const tz = bz.timezone || 'Asia/Seoul';
    const dk = (iso) => { const x = _partsIn(new Date(iso), tz); return `${x.y}-${x.m}-${x.d}`; };
    const sl3 = (await pub(`/api/guest/${A.ptok}/booking/slots`)).body.data.slots;
    if (dk(slots[0]) === dk(sl2[0])) push('하루 상한(2) 찬 날은 슬롯 0', !sl3.some((x) => dk(x) === dk(slots[0])), `남은 그 날 슬롯=${sl3.filter((x) => dk(x) === dk(slots[0])).length}`);
    else push('하루 상한 검사', false, '미측정 — 두 신청이 다른 날');
    const r3 = await pub(`/api/guest/${A.ptok}/booking`, { method: 'POST', body: JSON.stringify({ start: sl3[0], purpose: 'other' }) });
    const ev3 = r3.body?.data?.id;
    const r4 = await pub(`/api/guest/${A.ptok}/booking`, { method: 'POST', body: JSON.stringify({ start: sl3[1], purpose: 'other' }) });
    push('대기 중 3건 후 4번째 → 429', r3.status === 201 && r4.status === 429, `r3=${r3.status} r4=${r4.status} ${r4.body?.message}`);

    // ── 확인필요
    const todo = await api(`/api/dashboard/todo?business_id=${BIZ}`);
    const items = todo.body.data.items;
    const bk = items.filter((i) => i.type === 'booking');
    push('확인필요: 상담 신청 3건 (type booking · verb schedule)', bk.length === 3 && bk.every((i) => i.verb === 'schedule' && i.link.startsWith('/calendar?event=')), `n=${bk.length}`);
    const evDup = items.filter((i) => i.type === 'event' && [ev1, ev2, ev3].some((id) => String(i.id).startsWith(`event-${id}`)));
    push('같은 신청이 «참석 응답» 에 또 뜨지 않는다', evDup.length === 0, `n=${evDup.length}`);
    const saleDup = items.filter((i) => i.type === 'sale' && i.link && i.link.includes(encodeURIComponent('예약a')));
    push('같은 고객이 «답 안 한 문의»·«다음 할 일» 에 또 뜨지 않는다', saleDup.length === 0, `n=${saleDup.length}`);
    const sumTypes = items.length; // total 은 all 기준
    push('total ≥ 버킷 합 (부분집합)', todo.body.data.total >= bk.length && todo.body.data.total >= sumTypes - todo.body.data.hidden, `total=${todo.body.data.total}`);

    // ── 팀 동작
    const ap = await api(`/api/calendar/booking/${BIZ}/${ev1}/approve`, { method: 'POST', body: '{}' });
    push('승인 → confirmed', ap.status === 200 && ap.body?.data?.booking_status === 'confirmed', `${ap.status} ${ap.body?.message || ''}`);
    const ap2 = await api(`/api/calendar/booking/${BIZ}/${ev1}/approve`, { method: 'POST', body: '{}' });
    push('두 번 승인 → 409', ap2.status === 409, String(ap2.status));
    const [cst] = await q('SELECT sales_stage FROM clients WHERE id=?', [clientA]);
    push('승인 → 영업 단계 consulting', cst.sales_stage === 'consulting', cst.sales_stage);
    const [r1b] = await q('SELECT reminder_minutes, gcal_sync_personal FROM calendar_events WHERE id=?', [ev1]);
    push('승인 → 알림 1일 전·개인 구글 동기화 켜짐', r1b.reminder_minutes === 1440 && !!r1b.gcal_sync_personal, JSON.stringify(r1b));
    await new Promise((r) => setTimeout(r, 1500));
    const mails = await q("SELECT template, status FROM email_logs WHERE to_email=? ORDER BY id", [A.mail]);
    // example.com 은 발송 차단(skipped)이라 «시도가 기록됐는가» 로 잰다 — 부르는 경로가 살아 있는지
    push('메일: requested 3 · confirmed 1 이 발송 시도됨(example.com → skipped)', mails.filter((m) => m.template === 'guest_booking_requested').length === 3 && mails.filter((m) => m.template === 'guest_booking_confirmed').length === 1, JSON.stringify(mails.map((m) => `${m.template}:${m.status}`)));

    // .ics 모양
    const { buildIcs } = require('/opt/planq/dev-backend/services/booking');
    const { CalendarEvent } = require('/opt/planq/dev-backend/models');
    const ics = buildIcs(await CalendarEvent.findByPk(ev1), { workspaceName: 'WS, Inc', meetingUrl: null });
    push('.ics: VEVENT·UID 고정·쉼표 이스케이프', /BEGIN:VEVENT/.test(ics) && ics.includes(`UID:booking-${ev1}@`) && ics.includes('WS\\, Inc') && ics.includes('\r\n'), '');

    const future = new Date(Date.now() + 5 * 86400000); future.setUTCMinutes(0, 0, 0);
    const pr = await api(`/api/calendar/booking/${BIZ}/${ev2}/propose`, { method: 'POST', body: JSON.stringify({ start: future.toISOString() }) });
    push('다른 시간 제안 → proposed · 길이 유지', pr.status === 200 && pr.body.data.booking_status === 'proposed' && (new Date(pr.body.data.end_at) - new Date(pr.body.data.start_at)) === 30 * 60000, `${pr.status}`);
    const pastP = await api(`/api/calendar/booking/${BIZ}/${ev2}/propose`, { method: 'POST', body: JSON.stringify({ start: new Date(Date.now() - 3600e3).toISOString() }) });
    push('과거 시각 제안 → 409', pastP.status === 409, String(pastP.status));

    const mine = await pub(`/api/guest/${A.ptok}/booking/mine`);
    const m2 = (mine.body?.data || []).find((x) => x.id === ev2);
    const mineKeys = Object.keys(m2 || {}).sort().join(',');
    push('내 문의: 제안 상태가 보인다 · 키 화이트리스트', m2 && m2.status === 'proposed' && mineKeys === 'end_at,id,meeting_url,start_at,status,title', mineKeys);
    push('내 문의 원문에 메모·담당자 없음', !mine.text.includes('메모 테스트') && !mine.text.includes('created_by'), '');

    // 다른 방문자는 A 의 예약을 못 만진다
    const Bv = await visitor(entry, 'b');
    const steal = await pub(`/api/guest/${Bv.ptok}/booking/${ev2}/accept`, { method: 'POST', body: '{}' });
    push('다른 방문자가 A 예약 수락 → 404', steal.status === 404, String(steal.status));
    const bMine = await pub(`/api/guest/${Bv.ptok}/booking/mine`);
    push('다른 방문자의 내 문의는 비어 있다', Array.isArray(bMine.body?.data) && bMine.body.data.length === 0, JSON.stringify(bMine.body?.data));

    const acc = await pub(`/api/guest/${A.ptok}/booking/${ev2}/accept`, { method: 'POST', body: '{}' });
    push('고객 수락 → confirmed', acc.status === 200 && acc.body.data.status === 'confirmed', `${acc.status} ${acc.body?.message || ''}`);

    // 받는 주소 — 확인창이 보여 주는 값 = 실제로 보내는 곳
    const rc = await api(`/api/calendar/booking/${BIZ}/${ev3}/recipient`);
    push('받는 주소 조회 = 그 고객의 확인된 이메일', rc.status === 200 && rc.body?.data?.email === A.mail, JSON.stringify(rc.body?.data));
    // 일반 수정·삭제로 예약 시간을 바꾸거나 지우지 못한다
    const mv = await api(`/api/calendar/by-business/${BIZ}/${ev3}`, { method: 'PUT', body: JSON.stringify({ start_at: new Date(Date.now() + 9 * 86400e3).toISOString() }) });
    const tt = await api(`/api/calendar/by-business/${BIZ}/${ev3}`, { method: 'PUT', body: JSON.stringify({ description: '팀 메모' }) });
    const del = await api(`/api/calendar/by-business/${BIZ}/${ev3}`, { method: 'DELETE' });
    push('예약 시간 직접 수정 409 · 메모 수정은 200 · 살아 있는 예약 삭제 409', mv.status === 409 && tt.status === 200 && del.status === 409, `mv=${mv.status} memo=${tt.status} del=${del.status}`);
    const dc = await api(`/api/calendar/booking/${BIZ}/${ev3}/decline`, { method: 'POST', body: '{}' });
    push('거절 → declined', dc.status === 200 && dc.body.data.booking_status === 'declined', String(dc.status));
    const cDeclined = await pub(`/api/guest/${A.ptok}/booking/${ev3}/cancel`, { method: 'POST', body: '{}' });
    push('거절된 것 취소 → 409', cDeclined.status === 409, String(cDeclined.status));
    const cc = await pub(`/api/guest/${A.ptok}/booking/${ev1}/cancel`, { method: 'POST', body: '{}' });
    push('고객이 확정 건 취소 → canceled', cc.status === 200 && cc.body.data.status === 'canceled', String(cc.status));

    // ── 끝남 → 상담 원장 (멱등)
    await q('UPDATE calendar_events SET start_at=DATE_SUB(NOW(), INTERVAL 2 HOUR), end_at=DATE_SUB(NOW(), INTERVAL 90 MINUTE) WHERE id=?', [ev2]);
    const bk2 = require('/opt/planq/dev-backend/services/booking');
    await bk2.recordFinishedBookings(); await bk2.recordFinishedBookings();
    const ints = await q('SELECT kind, source_kind, origin, client_id FROM client_interactions WHERE calendar_event_id=?', [ev2]);
    push('끝남 cron 2회 → 상담 기록 1행(meeting·calendar·auto)', ints.length === 1 && ints[0].kind === 'meeting' && ints[0].source_kind === 'calendar' && ints[0].origin === 'auto' && ints[0].client_id === clientA, JSON.stringify(ints));
    const mineDone = (await pub(`/api/guest/${A.ptok}/booking/mine`)).body.data.find((x) => x.id === ev2);
    push('내 문의: 지난 확정 건은 «끝남»', mineDone && mineDone.status === 'done', mineDone && mineDone.status);

    // 권한 — 고객 역할은 여전히 일정 생성 불가(event_actions 무변경 확인은 코드). 팀 라우트 무인증 401
    const noauth = await pub(`/api/calendar/booking/${BIZ}/${ev3}/approve`, { method: 'POST', body: '{}' });
    push('팀 라우트 무인증 401', noauth.status === 401, String(noauth.status));
    const otherBiz = await api(`/api/calendar/booking/${BIZ === 1 ? 2 : 1}/${ev3}/approve`, { method: 'POST', body: '{}' });
    push('남의 워크스페이스 경로 → 403/404', [403, 404].includes(otherBiz.status), String(otherBiz.status));

    // 예약 끄기 → 슬롯 enabled:false · 신청 409
    await api(`/api/businesses/${BIZ}/customer-entry`, { method: 'PUT', body: JSON.stringify({ booking: { enabled: false } }) });
    const off = await pub(`/api/guest/${A.ptok}/booking/slots`);
    const offReq = await pub(`/api/guest/${A.ptok}/booking`, { method: 'POST', body: JSON.stringify({ start: sl3[2], purpose: 'other' }) });
    push('예약 끄면 슬롯 비고 신청 409', off.body?.data?.enabled === false && off.body.data.slots.length === 0 && offReq.status === 409, `${offReq.status} ${offReq.body?.message}`);
  } catch (e) {
    push('실행 오류 없음', false, e.message);
  } finally {
    // ── 정리
    try {
      const clientIds = (await q(`SELECT id FROM clients WHERE business_id=? AND invite_email IN (?)`, [BIZ, cleanup.emails.length ? cleanup.emails : ['-']])).map((r) => r.id);
      const evIds = clientIds.length ? (await q('SELECT DISTINCT event_id FROM calendar_event_attendees WHERE client_id IN (?)', [clientIds])).map((r) => r.event_id) : [];
      if (evIds.length) {
        await q('DELETE FROM client_interactions WHERE calendar_event_id IN (?)', [evIds]);
        await q('DELETE FROM calendar_event_gcal_links WHERE event_id IN (?)', [evIds]).catch(() => null);
        await q('DELETE FROM calendar_event_attendees WHERE event_id IN (?)', [evIds]);
        await q('DELETE FROM calendar_events WHERE id IN (?)', [evIds]);
      }
      const rooms = cleanup.links.length ? (await q('SELECT conversation_id FROM guest_links WHERE id IN (?) AND conversation_id IS NOT NULL', [cleanup.links])).map((r) => r.conversation_id) : [];
      const shadows = cleanup.links.length ? (await q('SELECT guest_user_id FROM guest_links WHERE id IN (?)', [cleanup.links])).map((r) => r.guest_user_id).filter(Boolean) : [];
      await q('DELETE FROM guest_links WHERE id IN (?)', [cleanup.links.length ? cleanup.links : [0]]);
      if (rooms.length) {
        await q('DELETE FROM messages WHERE conversation_id IN (?)', [rooms]);
        await q('DELETE FROM conversation_participants WHERE conversation_id IN (?)', [rooms]);
        await q('DELETE FROM conversations WHERE id IN (?)', [rooms]);
      }
      if (clientIds.length) {
        await q('DELETE FROM client_stage_history WHERE client_id IN (?)', [clientIds]);
        await q('DELETE FROM clients WHERE id IN (?)', [clientIds]);
      }
      if (shadows.length) await q('DELETE FROM users WHERE id IN (?) AND is_guest=1', [shadows]).catch((e) => console.log('shadow del', e.message));
      if (cleanup.convIssued) await q('DELETE FROM guest_links WHERE id=?', [cleanup.convIssued]);
      if (cleanup.entryIssued) {
        await q('DELETE FROM guest_links WHERE parent_link_id=?', [cleanup.entryIssued]);
        await q('DELETE FROM guest_links WHERE id=?', [cleanup.entryIssued]);
      }
      if (cleanup.emails.length) await q('DELETE FROM email_logs WHERE to_email IN (?)', [cleanup.emails]);
      await q('UPDATE businesses SET permissions=?, work_hours=? WHERE id=?', [JSON.stringify(cleanup.permsBefore), cleanup.whBefore == null ? null : JSON.stringify(cleanup.whBefore), BIZ]);
      const [after] = await q('SELECT permissions FROM businesses WHERE id=?', [BIZ]);
      const left = await q('SELECT COUNT(*) n FROM clients WHERE invite_email IN (?)', [cleanup.emails.length ? cleanup.emails : ['-']]);
      const restored = JSON.stringify(after.permissions) === JSON.stringify(cleanup.permsBefore);
      results.push({ name: 'cleanup:booking-api', fail: Number(left[0].n) || !restored ? 1 : 0, hasCanary: true,
        details: [`고객 남음 ${left[0].n} · 설정 원복 ${restored}`] });
    } catch (e) { results.push({ name: 'cleanup:booking-api', fail: 1, details: [`🔴 정리 실패: ${e.message}`] }); }
    // ★ 풀은 닫지 않는다 — 러너가 마지막에 한 번 닫는다.
  }
  return results;
}

module.exports = { run };
