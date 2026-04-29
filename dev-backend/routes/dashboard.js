const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const {
  Task, TaskReviewer,
  CalendarEvent, CalendarEventAttendee, Project,
  Client, BusinessMember, Business, User,
  TaskCandidate, Conversation,
  Invoice, InvoiceInstallment, SignatureRequest, Post,
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
    attributes: ['id', 'title', 'due_date', 'createdAt'],
    include: [{ model: User, as: 'requester', attributes: ['id', 'name', 'name_localized'], required: false }],
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
      createdAt: safeToIso(t.createdAt),
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
    attributes: ['id', 'title', 'due_date', 'updatedAt'],
    include: [{ model: User, as: 'requester', attributes: ['id', 'name', 'name_localized'], required: false }],
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
      createdAt: safeToIso(t.updatedAt),
      actor: t.requester ? { name: t.requester.name } : null,
      drawer: { kind: 'task', id: t.id },
    });
  }

  // 3) 내가 컨펌자 (pending)
  const pendingReviews = await TaskReviewer.findAll({
    where: { user_id: userId, state: 'pending' },
    attributes: ['id', 'createdAt'],
    include: [{
      model: Task,
      required: true,
      where: { business_id: businessId, status: { [Op.notIn]: ['completed', 'canceled'] } },
      attributes: ['id', 'title', 'due_date'],
      include: [{ model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false }],
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
      createdAt: safeToIso(r.createdAt),
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
    attributes: ['id', 'title', 'due_date', 'updatedAt'],
    include: [{ model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false }],
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
      createdAt: safeToIso(t.updatedAt),
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
    attributes: ['id', 'title', 'start_at', 'location', 'createdAt'],
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
        createdAt: safeToIso(ev.createdAt),
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
        createdAt: safeToIso(ev.createdAt),
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
    attributes: ['id', 'invite_email', 'business_id', 'createdAt'],
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
      createdAt: safeToIso(m.createdAt),
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
    attributes: ['id', 'invite_email', 'business_id', 'display_name', 'createdAt'],
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
      createdAt: safeToIso(c.createdAt),
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
        attributes: ['id', 'name', 'name_localized'],
        required: false,
      },
    ],
    order: [['extracted_at', 'DESC']],
    limit: 20,
  });
  return cands.flatMap((c) => {
    const assigneeName = c.guessedAssignee?.name || null;
    const isMine = c.guessedAssignee?.id === currentUserId;
    // 인박스 = "내가 직접 행동해야 할 것" 만. 다른 사람 담당 candidate 는 그 사람 인박스에 가야 함.
    // 본인 담당(accept) + 담당자 미지정(assign — owner/admin 이 지정 행동) 만 노출.
    if (assigneeName && !isMine) return [];

    const convId = c.Conversation?.id || c.conversation_id;
    const link = convId ? `/talk?conv=${convId}&candidate=${c.id}` : '/talk';
    const convName = c.Conversation?.display_name || c.Conversation?.title || '';
    const assigneeBadge = assigneeName ? '담당: 나' : '담당자 지정 필요';
    const context = convName ? `${convName} · ${assigneeBadge}` : assigneeBadge;
    return [{
      id: `candidate-${c.id}`,
      type: 'task_candidate',
      // 담당자 미지정 → 'assign' (담당자 지정 필요), 본인 담당 → 'accept'
      verb: !assigneeName ? 'assign' : 'accept',
      priority: 'waiting',
      subject: c.title,
      context,
      dueAt: null,
      createdAt: safeToIso(c.extracted_at || c.extractedAt),
      actor: { name: 'Q Talk' },
      link,
    }];
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
      // notify_paid_at 이 있는 건은 collectPaymentNotifies 가 처리 (중복 방지)
      notify_paid_at: null,
    },
    attributes: ['id', 'invoice_number', 'recipient_business_name', 'grand_total', 'paid_amount', 'due_date', 'status', 'currency', 'sent_at', 'createdAt'],
    order: [['due_date', 'ASC']],
    limit: 20,
  });
  const items = [];
  for (const inv of invoices) {
    const paid = Number(inv.paid_amount || 0);
    const total = Number(inv.grand_total || 0);
    if (total <= paid) continue;
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
      createdAt: safeToIso(inv.sent_at || inv.createdAt),
      amount: total - paid,
      currency: inv.currency || 'KRW',
      actor: inv.recipient_business_name ? { name: inv.recipient_business_name } : null,
      link: `/bills?tab=invoices&invoice=${inv.id}`,
    });
  }
  return items;
}

/* ─────────────────────────────────────────────
   서명 요청 (Phase A)
   - 내가 서명자인 미서명 요청 (signer_email = userEmail, status sent/viewed)
   - 워크스페이스 발행분 진행 중 (waiting other party — owner/admin 만)
   - 거절 받음 (today, owner/admin 만)
   ──────────────────────────────────────────── */
async function collectSignatures(businessId, userEmail, userRole) {
  const items = [];
  const now = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000;

  // 내가 서명자 — 모든 워크스페이스에서 받은 서명 요청 (이메일 기준)
  if (userEmail) {
    const myReqs = await SignatureRequest.findAll({
      where: {
        signer_email: userEmail,
        status: { [Op.in]: ['sent', 'viewed'] },
      },
      attributes: ['id', 'token', 'signer_email', 'signer_name', 'status', 'expires_at', 'entity_type', 'entity_id', 'business_id', 'createdAt'],
      order: [['expires_at', 'ASC']],
      limit: 30,
    });
    // entity 제목 한 번에 fetch
    const postIds = [...new Set(myReqs.filter(r => r.entity_type === 'post').map(r => r.entity_id))];
    const posts = postIds.length
      ? await Post.findAll({ where: { id: { [Op.in]: postIds } }, attributes: ['id', 'title', 'category'] })
      : [];
    const postMap = Object.fromEntries(posts.map(p => [p.id, p]));

    for (const sr of myReqs) {
      const expiresAt = sr.expires_at ? new Date(sr.expires_at) : null;
      const expired = expiresAt && expiresAt < now;
      if (expired) continue; // 만료된 건 표시 안 함
      const ms = expiresAt ? expiresAt.getTime() - now.getTime() : Infinity;
      const priority = ms < oneDayMs ? 'urgent' : (ms < 3 * oneDayMs ? 'today' : 'week');
      const post = sr.entity_type === 'post' ? postMap[sr.entity_id] : null;
      const subject = post ? post.title : `${sr.entity_type}#${sr.entity_id}`;
      items.push({
        id: `sign-recv-${sr.id}`,
        type: 'signature',
        priority,
        verb: 'sign',
        subject,
        context: expiresAt ? `만료: ${formatDateShort(expiresAt)}` : null,
        dueAt: safeToIso(expiresAt),
        createdAt: safeToIso(sr.createdAt),
        actor: { name: sr.signer_name || sr.signer_email },
        link: `/sign/${sr.token}`,
      });
    }
  }

  // 발행자 측 — owner/admin 만 (member 는 본인이 발행한 건 위주로 보고 싶을 수도 있으나 단순화)
  if (businessId && (userRole === 'owner' || userRole === 'admin')) {
    // 거절 받음 (최근 7일)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400 * 1000);
    const rejected = await SignatureRequest.findAll({
      where: {
        business_id: businessId,
        status: 'rejected',
        rejected_at: { [Op.gte]: sevenDaysAgo },
      },
      attributes: ['id', 'token', 'signer_email', 'signer_name', 'status', 'rejected_at', 'rejected_reason', 'entity_type', 'entity_id'],
      order: [['rejected_at', 'DESC']],
      limit: 10,
    });
    const rejPostIds = [...new Set(rejected.filter(r => r.entity_type === 'post').map(r => r.entity_id))];
    const rejPosts = rejPostIds.length
      ? await Post.findAll({ where: { id: { [Op.in]: rejPostIds } }, attributes: ['id', 'title', 'project_id'] })
      : [];
    const rejPostMap = Object.fromEntries(rejPosts.map(p => [p.id, p]));
    for (const sr of rejected) {
      const post = sr.entity_type === 'post' ? rejPostMap[sr.entity_id] : null;
      const subject = post ? post.title : `${sr.entity_type}#${sr.entity_id}`;
      const link = post && sr.entity_type === 'post' ? `/qdocs?post=${sr.entity_id}` : null;
      items.push({
        id: `sign-rejected-${sr.id}`,
        type: 'signature',
        priority: 'today',
        verb: 'sign_rejected',
        subject,
        context: `${sr.signer_name || sr.signer_email} 거절${sr.rejected_reason ? ` — ${String(sr.rejected_reason).slice(0, 40)}` : ''}`,
        dueAt: safeToIso(sr.rejected_at),
        createdAt: safeToIso(sr.rejected_at),
        actor: { name: sr.signer_name || sr.signer_email },
        link,
      });
    }
  }

  return items;
}

function formatDateShort(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

/* ─────────────────────────────────────────────
   결제 알림 — 고객이 송금 완료 알림 보낸 후 발행자 마킹 대기 (Phase C)
   ──────────────────────────────────────────── */
async function collectPaymentNotifies(businessId, userRole) {
  if (!businessId) return [];
  // owner/admin 만 (결제 마킹 권한)
  if (userRole !== 'owner' && userRole !== 'admin') return [];

  const items = [];

  // 단일 invoice 알림
  const invoices = await Invoice.findAll({
    where: {
      business_id: businessId,
      notify_paid_at: { [Op.ne]: null },
      status: { [Op.in]: ['sent', 'overdue', 'partially_paid'] },
    },
    attributes: ['id', 'invoice_number', 'title', 'grand_total', 'paid_amount', 'currency', 'notify_paid_at', 'notify_payer_name', 'installment_mode'],
    include: [{ model: Client, attributes: ['display_name', 'biz_name', 'company_name'] }],
    order: [['notify_paid_at', 'DESC']],
    limit: 20,
  });
  for (const inv of invoices) {
    if (inv.installment_mode === 'split') continue; // 분할은 회차 단위로
    const total = Number(inv.grand_total || 0);
    const paid = Number(inv.paid_amount || 0);
    if (total <= paid) continue;
    const clientName = inv.Client?.biz_name || inv.Client?.company_name || inv.Client?.display_name || '';
    const cur = inv.currency === 'USD' ? '$' : '₩';
    items.push({
      id: `paynotify-inv-${inv.id}`,
      type: 'payment_notify',
      priority: 'urgent',
      verb: 'mark_paid',
      subject: `${inv.invoice_number} · ${cur}${(total - paid).toLocaleString('ko-KR')} ${clientName ? `· ${clientName}` : ''}`.trim(),
      context: `송금 완료 알림 받음${inv.notify_payer_name ? ` · 입금자명: ${inv.notify_payer_name}` : ''}`,
      dueAt: safeToIso(inv.notify_paid_at),
      createdAt: safeToIso(inv.notify_paid_at),
      amount: total - paid,
      currency: inv.currency || 'KRW',
      actor: { name: inv.notify_payer_name || clientName || '고객' },
      link: `/bills?tab=invoices&invoice=${inv.id}`,
    });
  }

  // 회차별 알림
  const insts = await InvoiceInstallment.findAll({
    where: {
      notify_paid_at: { [Op.ne]: null },
      status: { [Op.in]: ['sent', 'overdue'] },
    },
    attributes: ['id', 'invoice_id', 'installment_no', 'label', 'amount', 'notify_paid_at', 'notify_payer_name'],
    include: [{
      model: Invoice,
      where: { business_id: businessId },
      attributes: ['id', 'invoice_number', 'currency'],
      include: [{ model: Client, attributes: ['display_name', 'biz_name', 'company_name'] }],
    }],
    order: [['notify_paid_at', 'DESC']],
    limit: 30,
  });
  for (const inst of insts) {
    if (!inst.Invoice) continue;
    const inv = inst.Invoice;
    const clientName = inv.Client?.biz_name || inv.Client?.company_name || inv.Client?.display_name || '';
    const cur = inv.currency === 'USD' ? '$' : '₩';
    items.push({
      id: `paynotify-inst-${inst.id}`,
      type: 'payment_notify',
      priority: 'urgent',
      verb: 'mark_paid',
      subject: `${inv.invoice_number} · ${inst.label} · ${cur}${Number(inst.amount).toLocaleString('ko-KR')} ${clientName ? `· ${clientName}` : ''}`.trim(),
      context: `송금 완료 알림 받음${inst.notify_payer_name ? ` · 입금자명: ${inst.notify_payer_name}` : ''}`,
      dueAt: safeToIso(inst.notify_paid_at),
      createdAt: safeToIso(inst.notify_paid_at),
      amount: Number(inst.amount),
      currency: inv.currency || 'KRW',
      actor: { name: inst.notify_payer_name || clientName || '고객' },
      link: `/bills?tab=invoices&invoice=${inv.id}`,
    });
  }

  return items;
}

/* ─────────────────────────────────────────────
   세금계산서 발행 마감 — 사업자 고객 paid 회차 중 미발행
   (단일 invoice 도 사업자 고객이고 paid 면 포함 — 분할 회차 단위로 묶어서 처리)
   ──────────────────────────────────────────── */
async function collectTaxInvoices(businessId, userRole) {
  if (!businessId) return [];
  if (userRole !== 'owner' && userRole !== 'admin') return [];

  const items = [];

  // 분할 회차: paid + tax_invoice_no IS NULL + 한국 사업자 고객 (해외 영세율 거래는 제외)
  const insts = await InvoiceInstallment.findAll({
    where: {
      status: 'paid',
      tax_invoice_no: null,
    },
    attributes: ['id', 'invoice_id', 'installment_no', 'label', 'amount', 'paid_at'],
    include: [{
      model: Invoice,
      where: { business_id: businessId },
      attributes: ['id', 'invoice_number', 'currency'],
      include: [{
        model: Client,
        where: { is_business: true, country: 'KR' },
        attributes: ['biz_name', 'company_name', 'display_name'],
        required: true,
      }],
      required: true,
    }],
    order: [['paid_at', 'ASC']],
    limit: 30,
  });
  for (const inst of insts) {
    if (!inst.Invoice) continue;
    const inv = inst.Invoice;
    const clientName = inv.Client?.biz_name || inv.Client?.company_name || inv.Client?.display_name || '';
    const cur = inv.currency === 'USD' ? '$' : '₩';
    // 마감 = paid_at + 30일 (한국 세금계산서 발행 마감 — 다음 달 10일 기준이지만 단순화)
    const paidAt = inst.paid_at ? new Date(inst.paid_at) : null;
    const dueAt = paidAt ? new Date(paidAt.getTime() + 30 * 86400 * 1000) : null;
    const overdue = dueAt && dueAt < new Date();
    const ms = dueAt ? dueAt.getTime() - Date.now() : Infinity;
    const priority = overdue ? 'urgent' : (ms < 7 * 86400 * 1000 ? 'today' : 'week');
    items.push({
      id: `tax-inst-${inst.id}`,
      type: 'tax_invoice',
      priority,
      verb: 'issue_tax',
      subject: `${inv.invoice_number} · ${inst.label} · ${cur}${Number(inst.amount).toLocaleString('ko-KR')} · ${clientName}`,
      context: paidAt ? `결제일: ${formatDateShort(paidAt)}${overdue ? ' · 마감 지남' : ''}` : null,
      dueAt: safeToIso(dueAt),
      createdAt: safeToIso(paidAt),
      amount: Number(inst.amount),
      currency: inv.currency || 'KRW',
      actor: { name: clientName || '사업자 고객' },
      link: `/bills?tab=tax-invoices`,
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
    const oneBusinessId = Number.isFinite(qBusinessId) ? qBusinessId : null;
    const { getUserScope } = require('../middleware/access_scope');

    // business_id 가 명시되면 그 워크스페이스만 (권한 검증 후), 아니면 사용자가 속한 **모든** 워크스페이스 cross-workspace 집계
    if (oneBusinessId && !isPlatformAdmin) {
      const scope = await getUserScope(userId, oneBusinessId, req.user.platform_role);
      if (!scope.isOwner && !scope.isMember && !scope.isClient) {
        return errorResponse(res, 'forbidden', 403);
      }
    }

    // 사용자가 속한 워크스페이스 목록 (member + client 양쪽)
    let workspaces = [];
    if (oneBusinessId) {
      const biz = await Business.findByPk(oneBusinessId, { attributes: ['id', 'name', 'brand_name'] });
      // removed_at 체크 추가 — cross-workspace 와 일관성 유지
      const bm = await BusinessMember.findOne({
        where: { user_id: userId, business_id: oneBusinessId, removed_at: null },
        attributes: ['role'],
      });
      const cli = !bm ? await Client.findOne({
        where: { user_id: userId, business_id: oneBusinessId, status: 'active' },
        attributes: ['id'],
      }) : null;
      const role = bm?.role || (cli ? 'client' : (isPlatformAdmin ? 'admin' : null));
      // 권한 없으면 빈 배열 (아래 collectors 가 빈 결과 반환)
      if (biz && role) workspaces.push({ business_id: biz.id, brand_name: biz.brand_name || biz.name, role });
    } else {
      const memberships = await BusinessMember.findAll({
        where: { user_id: userId, removed_at: null },
        include: [{ model: Business, attributes: ['id', 'name', 'brand_name'] }],
      });
      const map = new Map();
      for (const m of memberships) {
        if (!m.Business || m.role === 'ai') continue;
        map.set(m.business_id, { business_id: m.business_id, brand_name: m.Business.brand_name || m.Business.name, role: m.role });
      }
      const clientRows = await Client.findAll({
        where: { user_id: userId, status: 'active' },
        include: [{ model: Business, attributes: ['id', 'name', 'brand_name'] }],
      });
      for (const c of clientRows) {
        if (!c.Business || map.has(c.business_id)) continue;
        map.set(c.business_id, { business_id: c.business_id, brand_name: c.Business.brand_name || c.Business.name, role: 'client' });
      }
      workspaces = Array.from(map.values()).sort((a, b) => a.business_id - b.business_id);
    }

    // 각 워크스페이스에서 collector 돌리고 항목마다 workspace 라벨 부착
    const allBuckets = await Promise.all(workspaces.map(async (w) => {
      const userRole = w.role === 'admin' ? 'admin' : w.role;
      const [tasks, events, candidates, invoices, signatures, paymentNotifies, taxInvoices] = await Promise.all([
        collectTasks(w.business_id, userId),
        collectEvents(w.business_id, userId),
        collectCandidates(w.business_id, userId),
        collectInvoices(w.business_id),
        collectSignatures(w.business_id, req.user.email, userRole),
        collectPaymentNotifies(w.business_id, userRole),
        collectTaxInvoices(w.business_id, userRole),
      ]);
      const items = [...tasks, ...events, ...candidates, ...invoices, ...signatures, ...paymentNotifies, ...taxInvoices];
      // 워크스페이스 라벨 부착
      for (const it of items) it.workspace = { business_id: w.business_id, brand_name: w.brand_name, role: w.role };
      return items;
    }));

    // invites 는 이메일 기반 (워크스페이스 무관) — 1번만 호출
    const invites = await collectInvites(req.user.email);

    const all = [...allBuckets.flat(), ...invites];

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

    return successResponse(res, { items: all, counts, total: all.length, workspaces });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
