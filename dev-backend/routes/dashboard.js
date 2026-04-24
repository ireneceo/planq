const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const {
  Task, TaskReviewer,
  CalendarEvent, CalendarEventAttendee, Project,
  Client, BusinessMember, Business, User,
} = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');

/* ─────────────────────────────────────────────
   Priority / verb 규칙
   ──────────────────────────────────────────── */
function bucketByDue(dueDate /* Date | null */) {
  if (!dueDate) return 'week';
  const now = new Date();
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const weekEnd = new Date(now.getTime() + 7 * 86400 * 1000);
  if (dueDate < now) return 'urgent';
  if (dueDate <= todayEnd) return 'today';
  if (dueDate <= weekEnd) return 'week';
  return 'week';
}

function toIsoDateOnlyAsDate(dateOnlyStr) {
  // Task.due_date 는 DATEONLY — '2026-04-24'. PlanQ 기본 tz (Asia/Seoul) 의 23:59 로 간주.
  // DATEONLY 가 Date 객체로 올 수도, ISO 문자열일 수도 있어 date part 만 추출.
  if (!dateOnlyStr) return null;
  let datePart;
  if (dateOnlyStr instanceof Date) {
    // Invalid Date 이면 toISOString 이 RangeError("Invalid time value") 던짐 → 가드
    if (isNaN(dateOnlyStr.getTime())) return null;
    datePart = dateOnlyStr.toISOString().slice(0, 10);
  } else {
    datePart = String(dateOnlyStr).slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const d = new Date(`${datePart}T23:59:59+09:00`);
  return isNaN(d.getTime()) ? null : d;
}

// 안전한 ISO string 변환 — Invalid Date 는 null 반환 (toJSON 에서 RangeError 방지)
function safeToIso(dt) {
  if (!dt) return null;
  const d = dt instanceof Date ? dt : new Date(dt);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/* ─────────────────────────────────────────────
   업무 집계 — 내가 담당 / 내가 컨펌자 / 내가 요청자(최종완료 대기)
   ──────────────────────────────────────────── */
async function collectTasks(businessId, userId) {
  const items = [];

  // 1) 요청 확인 미완료 — 타인이 나에게 할당했으나 아직 ack 안 누름
  const unconfirmed = await Task.findAll({
    where: {
      business_id: businessId,
      assignee_id: userId,
      request_by_user_id: { [Op.ne]: userId, [Op.not]: null },
      request_ack_at: null,
      status: { [Op.notIn]: ['completed', 'canceled'] },
    },
    attributes: ['id', 'title', 'due_date'],
    include: [{ model: User, as: 'requester', attributes: ['id', 'name'], required: false }],
    order: [['due_date', 'ASC']],
    limit: 30,
  });
  for (const t of unconfirmed) {
    const due = toIsoDateOnlyAsDate(t.due_date);
    items.push({
      id: `task-${t.id}-ack`,
      type: 'task',
      priority: bucketByDue(due),
      verb: 'ack',
      subject: t.title,
      context: t.requester ? `요청: ${t.requester.name}` : null,
      dueAt: due ? due.toISOString() : null,
      actor: t.requester ? { name: t.requester.name } : null,
      drawer: { kind: 'task', id: t.id },
    });
  }

  // 2) 수정 요청 받음 — 내 담당 + revision_requested
  const revisionReq = await Task.findAll({
    where: {
      business_id: businessId,
      assignee_id: userId,
      status: 'revision_requested',
    },
    attributes: ['id', 'title', 'due_date'],
    include: [{ model: User, as: 'requester', attributes: ['id', 'name'], required: false }],
    limit: 30,
  });
  for (const t of revisionReq) {
    const due = toIsoDateOnlyAsDate(t.due_date);
    items.push({
      id: `task-${t.id}-revise`,
      type: 'task',
      priority: due && due < new Date() ? 'urgent' : 'today',
      verb: 'revise',
      subject: t.title,
      context: t.requester ? `요청: ${t.requester.name}` : null,
      dueAt: due ? due.toISOString() : null,
      actor: t.requester ? { name: t.requester.name } : null,
      drawer: { kind: 'task', id: t.id },
    });
  }

  // 3) 내가 컨펌자 (pending)
  const pendingReviews = await TaskReviewer.findAll({
    where: { user_id: userId, state: 'pending' },
    include: [{
      model: Task,
      required: true,
      where: { business_id: businessId, status: { [Op.notIn]: ['completed', 'canceled'] } },
      attributes: ['id', 'title', 'due_date'],
      include: [{ model: User, as: 'assignee', attributes: ['id', 'name'], required: false }],
    }],
    limit: 30,
  });
  for (const r of pendingReviews) {
    const t = r.Task;
    if (!t) continue;
    const due = toIsoDateOnlyAsDate(t.due_date);
    items.push({
      id: `task-${t.id}-review`,
      type: 'task',
      priority: bucketByDue(due) === 'week' ? 'waiting' : bucketByDue(due),
      verb: 'confirm',
      subject: t.title,
      context: t.assignee ? `담당: ${t.assignee.name}` : null,
      dueAt: due ? due.toISOString() : null,
      actor: t.assignee ? { name: t.assignee.name } : null,
      drawer: { kind: 'task', id: t.id },
    });
  }

  // 3) 내가 요청자 + status = done_feedback (최종 완료 대기)
  const toApprove = await Task.findAll({
    where: {
      business_id: businessId,
      request_by_user_id: userId,
      status: 'done_feedback',
    },
    attributes: ['id', 'title', 'due_date'],
    include: [{ model: User, as: 'assignee', attributes: ['id', 'name'], required: false }],
    limit: 20,
  });
  for (const t of toApprove) {
    const due = toIsoDateOnlyAsDate(t.due_date);
    items.push({
      id: `task-${t.id}-approve`,
      type: 'task',
      priority: 'today',
      verb: 'approve',
      subject: t.title,
      context: t.assignee ? `담당: ${t.assignee.name}` : null,
      dueAt: due ? due.toISOString() : null,
      actor: t.assignee ? { name: t.assignee.name } : null,
      drawer: { kind: 'task', id: t.id },
    });
  }

  return items;
}

/* ─────────────────────────────────────────────
   캘린더 집계 — 액션 필요한 것만
   (a) 응답 pending (미래 미팅, 수락/거절 안 함)
   (b) accepted + 오늘 시작 (오늘 참석 리마인더)
   ──────────────────────────────────────────── */
async function collectEvents(businessId, userId) {
  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 86400 * 1000);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

  const events = await CalendarEvent.findAll({
    where: {
      business_id: businessId,
      start_at: { [Op.between]: [now, weekEnd] },
    },
    attributes: ['id', 'title', 'start_at', 'location'],
    include: [
      {
        model: CalendarEventAttendee, as: 'attendees', required: true,
        where: { user_id: userId },
        attributes: ['response'],
      },
      { model: Project, attributes: ['id', 'name'], required: false },
    ],
    order: [['start_at', 'ASC']],
    limit: 30,
  });

  const items = [];
  for (const ev of events) {
    const start = new Date(ev.start_at);
    const response = ev.attendees?.[0]?.response || 'pending';
    const isToday = start <= todayEnd;

    // (a) 응답 pending — 수락/거절 안 한 미팅은 항상 떠야
    if (response === 'pending') {
      items.push({
        id: `event-${ev.id}-respond`,
        type: 'event',
        priority: isToday ? 'urgent' : 'waiting',
        verb: 'respond',                                 // "참석 응답"
        subject: ev.title,
        context: ev.Project ? ev.Project.name : (ev.location || null),
        dueAt: safeToIso(ev.start_at),
        drawer: { kind: 'event', id: ev.id },
      });
      continue;
    }

    // (b) accepted + 오늘 — 오늘 참석 리마인더
    if (response === 'accepted' && isToday) {
      items.push({
        id: `event-${ev.id}`,
        type: 'event',
        priority: 'today',
        verb: 'attend',
        subject: ev.title,
        context: ev.Project ? ev.Project.name : (ev.location || null),
        dueAt: safeToIso(ev.start_at),
        drawer: { kind: 'event', id: ev.id },
      });
    }
    // accepted + 미래(내일 이후) 또는 declined → 제외
  }
  return items;
}

/* ─────────────────────────────────────────────
   초대 집계 — 내 이메일로 온 미수락 초대 (멤버/클라이언트)
   ──────────────────────────────────────────── */
async function collectInvites(userEmail) {
  if (!userEmail) return [];
  const items = [];

  // Member 초대
  const memberInvites = await BusinessMember.findAll({
    where: {
      invite_email: userEmail,
      user_id: null,
      removed_at: null,
    },
    attributes: ['id', 'invite_email', 'business_id'],
    include: [{ model: Business, attributes: ['id', 'name'], required: false }],
    limit: 10,
  });
  for (const m of memberInvites) {
    items.push({
      id: `invite-member-${m.id}`,
      type: 'invite',
      priority: 'waiting',
      verb: 'accept',
      subject: `${m.Business ? m.Business.name : '워크스페이스'} 멤버 초대`,
      context: '초대 수락 대기',
      actor: m.Business ? { name: m.Business.name } : null,
      inline: 'invite',
    });
  }

  // Client 초대
  const clientInvites = await Client.findAll({
    where: {
      invite_email: userEmail,
      status: 'invited',
      user_id: null,
    },
    attributes: ['id', 'invite_email', 'business_id', 'display_name'],
    include: [{ model: Business, attributes: ['id', 'name'], required: false }],
    limit: 10,
  });
  for (const c of clientInvites) {
    items.push({
      id: `invite-client-${c.id}`,
      type: 'invite',
      priority: 'waiting',
      verb: 'accept',
      subject: `${c.Business ? c.Business.name : '워크스페이스'} 고객 초대`,
      context: '초대 수락 대기',
      actor: c.Business ? { name: c.Business.name } : null,
      inline: 'invite',
    });
  }

  return items;
}

/* ─────────────────────────────────────────────
   GET /api/dashboard/todo
   Query: ?business_id=... (생략 시 사용자 첫 biz)
   ──────────────────────────────────────────── */
router.get('/todo', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const isPlatformAdmin = req.user.platform_role === 'platform_admin';
    const qBusinessId = parseInt(req.query.business_id, 10);
    let businessId = Number.isFinite(qBusinessId) ? qBusinessId : null;

    // business_id 가 명시되면 **반드시** 멤버십 검증 (platform_admin 자동 통과).
    // 검증 누락 시 타 워크스페이스 todo 조회 가능 → Critical.
    if (businessId && !isPlatformAdmin) {
      const bm = await BusinessMember.findOne({
        where: { user_id: userId, business_id: businessId },
        attributes: ['business_id'],
      });
      if (!bm) return errorResponse(res, 'forbidden', 403);
    }

    // 기본값: 사용자의 첫 소속 워크스페이스 (platform_admin 은 쿼리 없으면 invites 만)
    if (!businessId && !isPlatformAdmin) {
      const bm = await BusinessMember.findOne({
        where: { user_id: userId },
        attributes: ['business_id'],
        order: [['created_at', 'ASC']],
      });
      if (bm) businessId = bm.business_id;
    }

    const [tasks, events, invites] = await Promise.all([
      businessId ? collectTasks(businessId, userId) : Promise.resolve([]),
      businessId ? collectEvents(businessId, userId) : Promise.resolve([]),
      collectInvites(req.user.email),
    ]);

    // Phase 9 demo mocks — 실제 구현 시 routes/qmail, routes/notifications 로 교체
    const demoMocks = [
      {
        id: 'mention-demo-1',
        type: 'mention',
        priority: 'today',
        verb: 'read',
        subject: '워프로랩 디자인 채널 — "@아이린 이번 주 릴리즈 일정 공유해주세요"',
        context: 'Alex Kim · 3시간 전',
        dueAt: null,
        actor: { name: 'Alex Kim' },
        link: '/talk',
      },
      {
        id: 'email-demo-1',
        type: 'email',
        priority: 'today',
        verb: 'respond',
        subject: 'Acme Corp. — 4월 로고 시안 최종 피드백 요청',
        context: 'kim@acme.com · 1시간 전',
        dueAt: null,
        actor: { name: 'Kim Jiho' },
        link: '/mail',
      },
      {
        id: 'candidate-demo-1',
        type: 'task_candidate',
        priority: 'waiting',
        verb: 'accept',
        subject: 'Q Note 추출: "경쟁사 비교 분석표 작성"',
        context: '4/22 워프로랩 주간 회의',
        dueAt: null,
        actor: { name: 'Q Note AI' },
        link: '/notes',
      },
      {
        id: 'invoice-demo-1',
        type: 'invoice',
        priority: 'urgent',
        verb: 'pay',
        subject: 'Acme Corp. 4월 호스팅 청구서 — ₩330,000',
        context: '결제 기한: 2일 지남',
        dueAt: null,
        actor: { name: 'Acme Corp.' },
        link: '/bills',
      },
    ];

    const all = [...tasks, ...events, ...invites, ...demoMocks];

    // Sort: priority order → dueAt asc
    const PRI = { urgent: 0, today: 1, waiting: 2, week: 3 };
    all.sort((a, b) => {
      const pd = PRI[a.priority] - PRI[b.priority];
      if (pd !== 0) return pd;
      const da = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const db = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      return da - db;
    });

    const counts = { urgent: 0, today: 0, waiting: 0, week: 0 };
    all.forEach(it => { counts[it.priority] += 1; });

    return successResponse(res, { items: all, counts, total: all.length });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
