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

// 알릴 대상 — 멤버 참석자 + 계정이 있는 고객 참석자. 나 자신은 뺀다. 정본은 services/eventNotify.recipientsOf
//   (일정 초대·변경 알림과 같은 함수 — #462). 고객에게는 앱 알림만(메일 X).
const { recipientsOf } = require('../services/eventNotify');

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
        ctaLabel: (lang) => (lang === 'en' ? 'View event' : '일정 보기'), workspaceName: biz?.brand_name || biz?.name || null,
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

// POST /api/calendar/by-business/:businessId/:id/notify-recipients — #462 «변경 알림을 보낼까요?» 창의 받는 사람.
//   읽기만 한다. 실제 변경 알림은 PUT 이 같은 함수(recipientsOf)로 보낸다 — 묻는 이름과 받는 사람이 갈리지 않게.
router.post('/by-business/:businessId/:id/notify-recipients', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  // audit-exempt: 읽기 전용(받을 사람 이름만 돌려준다 — 아무것도 바꾸지 않는다)
  try {
    const ctx = await loadEditable(req, res);
    if (!ctx) return;
    const { members, clients } = await recipientsOf(ctx.event, req.user.id);
    return successResponse(res, { count: members.length + clients.length, names: [...members, ...clients].map((r) => r.name).filter(Boolean) });
  } catch (err) { next(err); }
});

module.exports = router;
