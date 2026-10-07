// 일정 참석자 알림 — 초대·변경 알림을 **누구에게 보내는가** 와 **보내는 일** 을 한 곳에 둔다 (#462, 2026-10-07).
//
//   김미정(#462): *"일정 추가할 때 참여자에게 알림 보낼지 말지 선택 안하고 다 가는 거야? 시간 수정할 땐 어떻게 되는
//   건데? 구글캘린더는 코멘트(선택) 추가해서 알림 보낼지 말지 정하는데."*
//   Fable 판정: 등록 창 «참석자에게 알림 보내기»(기본 켜짐) + 한 줄 메시지 · 시간·종일·장소가 **실제로** 바뀌면
//   «변경 알림을 보낼까요?»(받는 사람 이름) — 서버가 옛 값과 비교해 판정한다(화면의 «바뀜» 주장은 믿지 않는다).
//   알릴지 말지를 안 보내면(옛 화면) 종전 동작: 등록은 보냄, 변경은 안 보냄(fail-closed).
//
//   - 받는 사람 = 멤버 참석자 + **계정이 있는** 고객 참석자, 나 자신 제외, 거절한 사람 제외.
//     묻는 창의 «누구에게» 와 실제 보내는 대상이 같은 함수다(미팅자료 알림도 이 함수를 쓴다).
//   - 고객에게는 **앱 알림만**(skipChannels ['email']) — 메일·.ics 는 외부 발송 표면을 넓히는 일이라 넣지 않는다.
//   - 상담 예약(booking)은 여기로 오지 않는다 — PUT 이 시간·참석자 변경을 409 로 막고 services/booking.js 가 맡는다.
const { CalendarEventAttendee, Client, User, Business } = require('../models');

const MESSAGE_MAX = 300;

/** 알림 받을 사람 — { members:[{user_id,name}], clients:[{user_id,name}] } */
async function recipientsOf(event, meId, { onlyUserIds = null } = {}) {
  const rows = await CalendarEventAttendee.findAll({
    where: { event_id: event.id },
    include: [
      { model: User, as: 'user', attributes: ['id', 'name'], required: false },
      { model: Client, as: 'client', attributes: ['id', 'display_name', 'user_id'], required: false },
    ],
  });
  const members = [];
  const clients = [];
  const seen = new Set();
  for (const r of rows) {
    if (r.response === 'declined') continue;
    if (r.user_id && r.user_id !== meId && !seen.has(r.user_id)) {
      if (onlyUserIds && !onlyUserIds.has(r.user_id)) continue;
      seen.add(r.user_id);
      members.push({ user_id: r.user_id, name: r.user?.name || null });
    } else if (r.client && r.client.user_id && r.client.user_id !== meId && !seen.has(r.client.user_id)) {
      if (onlyUserIds && !onlyUserIds.has(r.client.user_id)) continue;
      seen.add(r.client.user_id);
      clients.push({ user_id: r.client.user_id, name: r.client.display_name || null });
    }
  }
  return { members, clients };
}

/** 참석자 알림을 받는 사람의 user_id 집합 — 변경 전 참석자를 기억할 때 쓴다(recipientsOf 와 같은 술어). */
async function recipientIdSet(event, meId) {
  const { members, clients } = await recipientsOf(event, meId);
  return new Set([...members, ...clients].map((r) => r.user_id));
}

/** 화면이 보낸 { send, message } 를 읽는다. 없으면 null(= 옛 화면, 종전 동작). */
function readNotifyChoice(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const message = String(raw.message || '').trim().slice(0, MESSAGE_MAX) || null;
  return { send: raw.send !== false, message };
}

/** 시간·종일·장소가 실제로 바뀌었는가 — 옛 값(스냅샷)과 새 행을 비교한다. */
function scheduleChanged(before, after) {
  const t = (v) => (v ? new Date(v).getTime() : null);
  return t(before.start_at) !== t(after.start_at)
    || t(before.end_at) !== t(after.end_at)
    || !!before.all_day !== !!after.all_day
    || String(before.location || '') !== String(after.location || '');
}

function whenText(ev, lang) {
  if (!ev || !ev.start_at) return '';
  const d = new Date(ev.start_at);
  return ev.all_day
    ? d.toLocaleDateString(lang === 'en' ? 'en-US' : 'ko-KR', { dateStyle: 'medium' })
    : d.toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

async function send({ kind, event, before, businessId, actorUserId, members, clients, message, ioApp }) {
  if (!members.length && !clients.length) return 0;
  const { notifyMany } = require('../routes/notifications');
  const biz = await Business.findByPk(businessId, { attributes: ['name', 'brand_name'] });
  const action = kind === 'change' ? 'calendar_changed' : 'calendar_invite';
  const body = (lang) => {
    const head = kind === 'change'
      ? `"${event.title}" · ${whenText(before, lang)} → ${whenText(event, lang)}`
      : `"${event.title}"${event.start_at ? ` · ${whenText(event, lang)}` : ''}`;
    return message ? `${head}\n${message}` : head;
  };
  const base = {
    businessId, eventKind: 'event',
    titleSpec: { feature: 'calendar', action, subject: event.title },
    body,
    link: `${process.env.APP_URL || 'https://dev.planq.kr'}/calendar?event=${event.id}`,
    ctaLabel: (lang) => (lang === 'en' ? 'View event' : '일정 보기'),
    workspaceName: biz?.brand_name || biz?.name || null,
    actorUserId, entityType: 'calendar_event', entityId: event.id, ioApp,
  };
  if (members.length) await notifyMany({ ...base, userIds: members.map((m) => m.user_id) });
  if (clients.length) await notifyMany({ ...base, userIds: clients.map((c) => c.user_id), skipChannels: ['email'] });
  return members.length + clients.length;
}

/** 초대 알림 — 등록 시 참석자 전원 / 수정 시 새로 들어온 사람만(onlyUserIds). */
async function sendInvite({ event, businessId, actorUserId, message, onlyUserIds, ioApp }) {
  const { members, clients } = await recipientsOf(event, actorUserId, { onlyUserIds });
  return send({ kind: 'invite', event, businessId, actorUserId, members, clients, message, ioApp });
}

/** 변경 알림 — 변경 전에도 참석자였던 사람에게(priorIds). before 는 { start_at, end_at, all_day, location } */
async function sendChange({ event, before, businessId, actorUserId, message, priorIds, ioApp }) {
  const { members, clients } = await recipientsOf(event, actorUserId, { onlyUserIds: priorIds });
  return send({ kind: 'change', event, before, businessId, actorUserId, members, clients, message, ioApp });
}

module.exports = { recipientsOf, recipientIdSet, readNotifyChoice, scheduleChanged, sendInvite, sendChange, MESSAGE_MAX };
