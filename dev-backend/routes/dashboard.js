const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const {
  Task, TaskReviewer,
  CalendarEvent, CalendarEventAttendee, Project,
  Client, BusinessMember, Business, User,
  TaskCandidate, Conversation,
  Invoice,
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
   Q Talk/Q Note 추출 후보 — pending 상태만
   사용자: "확인 필요" inbox 에 실데이터 표시
   ──────────────────────────────────────────── */
async function collectCandidates(businessId, currentUserId) {
  if (!businessId) return [];
  // task_candidates 는 business_id 컬럼이 없음 → conversation 또는 project 경유.
  const cands = await TaskCandidate.findAll({
    where: { status: 'pending' },
    include: [
      {
        model: Conversation,
        attributes: ['id', 'title', 'display_name', 'business_id'],
        where: { business_id: businessId },
        required: true,
      },
      // 추정 담당자 정보 — 담당자 미지정 시 "담당자 지정 필요" 표시용
      {
        model: User, as: 'guessedAssignee',
        attributes: ['id', 'name'],
        required: false,
      },
    ],
    order: [['extracted_at', 'DESC']],
    limit: 20,
  });
  return cands.map((c) => {
    const convId = c.Conversation?.id || c.conversation_id;
    const link = convId ? `/talk?conv=${convId}&candidate=${c.id}` : '/talk';
    const convName = c.Conversation?.display_name || c.Conversation?.title || '';
    const assigneeName = c.guessedAssignee?.name || null;
    const isMine = c.guessedAssignee?.id === currentUserId;
    // 담당자 표시 규칙:
    //   - 추정 담당자 있음: "담당: {이름}" (본인이면 "담당: 나")
    //   - 추정 담당자 없음: "담당자 지정 필요"
    let assigneeBadge;
    if (assigneeName) assigneeBadge = isMine ? '담당: 나' : `담당: ${assigneeName}`;
    else assigneeBadge = '담당자 지정 필요';
    const context = convName ? `${convName} · ${assigneeBadge}` : assigneeBadge;
    return {
      id: `candidate-${c.id}`,
      type: 'task_candidate',
      // 담당자 미지정 → 'assign' (담당자 지정 필요), 본인 담당 → 'accept', 다른 사람 담당 → 'review'
      verb: !assigneeName ? 'assign' : (isMine ? 'accept' : 'review'),
      priority: 'waiting',
      subject: c.title,
      context,
      dueAt: null,
      actor: { name: 'Q Talk' },
      link,
    };
  });
}

/* ─────────────────────────────────────────────
   미수금 / 연체 청구서 — owner/admin 만 보도록 collectInvoices 호출 시 가드
   ──────────────────────────────────────────── */
async function collectInvoices(businessId) {
  if (!businessId) return [];
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const invoices = await Invoice.findAll({
    where: {
      business_id: businessId,
      status: { [Op.in]: ['sent', 'overdue'] },
    },
    attributes: ['id', 'invoice_number', 'recipient_business_name', 'grand_total', 'paid_amount', 'due_date', 'status', 'currency'],
    order: [['due_date', 'ASC']],
    limit: 20,
  });
  const items = [];
  for (const inv of invoices) {
    const paid = Number(inv.paid_amount || 0);
    const total = Number(inv.grand_total || 0);
    if (total <= paid) continue; // 이미 완납된 건은 제외
    const dueStr = inv.due_date ? String(inv.due_date).slice(0, 10) : null;
    const overdue = dueStr && dueStr < todayStr;
    const dueAt = dueStr ? new Date(`${dueStr}T23:59:59+09:00`) : null;
    items.push({
      id: `invoice-${inv.id}`,
      type: 'invoice',
      priority: overdue ? 'urgent' : (dueStr === todayStr ? 'today' : 'week'),
      verb: 'pay',
      subject: `${inv.recipient_business_name || inv.invoice_number} — ${inv.currency === 'USD' ? '$' : '₩'}${Number(total - paid).toLocaleString('ko-KR')}`,
      context: dueStr ? (overdue ? `결제 기한: ${dueStr} (지남)` : `결제 기한: ${dueStr}`) : null,
      dueAt: safeToIso(dueAt),
      amount: total - paid,
      currency: inv.currency || 'KRW',
      actor: inv.recipient_business_name ? { name: inv.recipient_business_name } : null,
      link: '/bills',
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

    // 청구서는 owner/admin/member 모두 볼 수 있게 (워크스페이스 멤버십 검증은 위에서 완료)
    const [tasks, events, invites, candidates, invoices] = await Promise.all([
      businessId ? collectTasks(businessId, userId) : Promise.resolve([]),
      businessId ? collectEvents(businessId, userId) : Promise.resolve([]),
      collectInvites(req.user.email),
      businessId ? collectCandidates(businessId, userId) : Promise.resolve([]),
      businessId ? collectInvoices(businessId) : Promise.resolve([]),
    ]);

    // Q Mail (mention/email) 은 시스템 미구현 — 실 데이터 collector 추가 시 합류
    const all = [...tasks, ...events, ...invites, ...candidates, ...invoices];

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
