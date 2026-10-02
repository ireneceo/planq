// 일정 미팅자료(#411) — 상세에서 붙이기·떼기·참석자에게 알리기.
//
//   Irene(#411): *"파일첨부 문서찾기 하게 해서 사전 준비한 미팅자료 연결하게 해줘. 미리 참석자들이 보게.
//   그리고 연결된 파일이나 문서가 있으면 참석자에게 알릴건지 묻게 하고. 수정을 해도 알릴건지 물어야 해."*
//
// - 붙일 수 있는가는 services/eventAttachments 한 곳(일정 생성과 같은 함수).
// - 고치는 권한은 일정 편집과 같은 술어(services/calendarPermission.canEditEvent).
// - 알리기는 **붙이는 순간 자동으로 보내지 않는다** — 화면이 묻고, 사람이 고른 경우에만 이 문을 부른다.
//   묻는 창의 «누구에게» 와 실제 보내는 대상은 같은 함수(recipientsOf)다 — `dry:true` 로 먼저 읽는다.
// calendar.js 가 이미 1300줄이라 따로 둔다. 경로가 겹치지 않는다(메서드+꼬리 `/attachments`·`/notify-materials`).
const express = require('express');
const router = express.Router();
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserLimiter } = require('../middleware/costGuard');
const { createAuditLog } = require('../middleware/audit');
const calendarPermission = require('../services/calendarPermission');
const { attachableRows, keyOf } = require('../services/eventAttachments');
const {
  CalendarEvent, CalendarEventAttachment, CalendarEventAttendee, BusinessMember, Client, File, Post, User,
} = require('../models');

function broadcast(req, event) {
  const io = req.app.get('io');
  if (!io || !event.business_id) return;
  // 신호만(id·소속) — 받는 화면이 자기 권한으로 다시 읽는다(calendar.js broadcastEvent 와 같은 모양).
  io.to(`business:${event.business_id}`).emit('event:updated',
    { id: event.id, business_id: event.business_id, project_id: event.project_id || null });
}

// 공통 — 일정을 찾고 편집 권한을 본다. 실패하면 응답을 보내고 null.
async function loadEditable(req, res) {
  const businessId = Number(req.params.businessId);
  const eventId = Number(req.params.id);
  if (req.businessRole === 'client') { errorResponse(res, 'forbidden', 403); return null; }
  const event = await CalendarEvent.findOne({ where: { id: eventId, business_id: businessId } });
  if (!event) { errorResponse(res, 'not_found', 404); return null; }
  const bm = await BusinessMember.findOne({ where: { business_id: businessId, user_id: req.user.id } });
  if (!calendarPermission.canEditEvent(event, bm, req.user.id)) {
    errorResponse(res, calendarPermission.editDenyReason(event, bm, req.user.id) || 'forbidden', 403);
    return null;
  }
  return { event, businessId };
}

const listAttachments = (eventId) => CalendarEventAttachment.findAll({
  where: { event_id: eventId },
  order: [['sort_order', 'ASC'], ['id', 'ASC']],
  include: [
    { model: File, as: 'file', attributes: ['id', 'file_name', 'mime_type', 'file_size'], required: false },
    { model: Post, as: 'post', attributes: ['id', 'title'], required: false },
  ],
});

// POST /api/calendar/by-business/:businessId/:id/attachments  body: { attachments: [{file_id}|{post_id}] }
router.post('/by-business/:businessId/:id/attachments', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const ctx = await loadEditable(req, res);
    if (!ctx) return;
    const { event, businessId } = ctx;
    const current = await CalendarEventAttachment.findAll({ where: { event_id: event.id }, attributes: ['file_id', 'post_id', 'sort_order'] });
    const rows = await attachableRows({
      atts: req.body?.attachments, businessId, userId: req.user.id, eventId: event.id,
      existing: new Set(current.map(keyOf)),
      startOrder: current.reduce((m, r) => Math.max(m, r.sort_order + 1), 0),
    });
    if (rows.length) {
      await CalendarEventAttachment.bulkCreate(rows);
      await createAuditLog({
        user_id: req.user.id, business_id: businessId, action: 'event.materials_added',
        target_type: 'calendar_event', target_id: event.id,
        new_value: { attachments: rows.map(keyOf) }, ip_address: req.ip,
      });
      broadcast(req, event);
    }
    return successResponse(res, { added: rows.length, attachments: (await listAttachments(event.id)).map((a) => a.toJSON()) });
  } catch (err) { next(err); }
});

// DELETE /api/calendar/by-business/:businessId/:id/attachments/:attId
router.delete('/by-business/:businessId/:id/attachments/:attId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const ctx = await loadEditable(req, res);
    if (!ctx) return;
    const { event, businessId } = ctx;
    const row = await CalendarEventAttachment.findOne({ where: { id: Number(req.params.attId), event_id: event.id, business_id: businessId } });
    if (!row) return errorResponse(res, 'not_found', 404);
    const key = keyOf(row);
    await row.destroy();
    await createAuditLog({
      user_id: req.user.id, business_id: businessId, action: 'event.materials_removed',
      target_type: 'calendar_event', target_id: event.id,
      old_value: { attachment: key }, ip_address: req.ip,
    });
    broadcast(req, event);
    return successResponse(res, { attachments: (await listAttachments(event.id)).map((a) => a.toJSON()) });
  } catch (err) { next(err); }
});

// 알릴 대상 — 멤버 참석자 + 계정이 있는 고객 참석자. 나 자신은 뺀다.
//   고객에게는 앱 알림만(메일 X): 외부로 메일이 나가는 버튼은 받는 주소를 문구에 적어야 하는데(CLAUDE.md
//   «외부 발송은 확인을 받는다»), 이 창은 사람 이름만 보여 준다. 메일 초대는 일정 초대 흐름이 따로 맡는다.
async function recipientsOf(event, meId) {
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
      seen.add(r.user_id);
      members.push({ user_id: r.user_id, name: r.user?.name || null });
    } else if (r.client && r.client.user_id && r.client.user_id !== meId && !seen.has(r.client.user_id)) {
      seen.add(r.client.user_id);
      clients.push({ user_id: r.client.user_id, name: r.client.display_name || null });
    }
  }
  return { members, clients };
}

// POST /api/calendar/by-business/:businessId/:id/notify-materials  body: { dry?: true }
// 보내기만 센다 — 묻는 줄을 그리려고 대상을 읽는 dry 까지 세면, 자료를 몇 번 붙였다 떼는 것만으로
//   한도가 차서 «알릴까요?» 가 아예 안 뜬다(2026-10-02 카나리에서 실측 429).
const notifyLimiter = perUserLimiter('event-materials-notify', { windowMs: 10 * 60 * 1000, max: 10 });
const limitSendOnly = (req, res, next) => (req.body?.dry ? next() : notifyLimiter(req, res, next));

router.post('/by-business/:businessId/:id/notify-materials', authenticateToken, checkBusinessAccess, limitSendOnly,
  async (req, res, next) => {
    try {
      const ctx = await loadEditable(req, res);
      if (!ctx) return;
      const { event, businessId } = ctx;
      const { members, clients } = await recipientsOf(event, req.user.id);
      const names = [...members, ...clients].map((r) => r.name).filter(Boolean);
      if (req.body?.dry) return successResponse(res, { count: members.length + clients.length, names });
      const count = await CalendarEventAttachment.count({ where: { event_id: event.id } });
      if (!count) return errorResponse(res, 'no_materials', 400);
      if (!members.length && !clients.length) return errorResponse(res, 'no_recipients', 400);

      const { notifyMany } = require('./notifications');
      const { Business } = require('../models');
      const biz = await Business.findByPk(businessId, { attributes: ['name', 'brand_name'] });
      const base = {
        businessId, eventKind: 'event',
        titleSpec: { feature: 'calendar', action: 'calendar_materials', subject: event.title },
        body: `"${event.title}" · ${count}`,
        link: `${process.env.APP_URL || 'https://dev.planq.kr'}/calendar?event=${event.id}`,
        ctaLabel: '일정 보기', workspaceName: biz?.brand_name || biz?.name || null,
        actorUserId: req.user.id, entityType: 'calendar_event', entityId: event.id, ioApp: req.app,
      };
      if (members.length) await notifyMany({ ...base, userIds: members.map((m) => m.user_id) });
      if (clients.length) await notifyMany({ ...base, userIds: clients.map((c) => c.user_id), skipChannels: ['email'] });
      await createAuditLog({
        user_id: req.user.id, business_id: businessId, action: 'event.materials_notified',
        target_type: 'calendar_event', target_id: event.id,
        new_value: { members: members.length, clients: clients.length, materials: count }, ip_address: req.ip,
      });
      return successResponse(res, { notified: members.length + clients.length });
    } catch (err) { next(err); }
  });

module.exports = router;
