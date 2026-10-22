// 메일 «답변 담당» → 업무 한 건 (2026-10-22 · docs/MAIL_MEMBER_READ_AND_REPLY_OWNER_DESIGN.md §7 — Fable PASS).
//
// Irene: *"메일별 답변 담당자 지정이 되어서 내가 답변 할 예정인지 다른 사람에게 답변요청할건지 넣고 이걸 업무로 연결해서
//   자동등록되게 … 복잡하게 하지말고"*
//
// 계약
//   · 한 스레드 = 열린 답변 업무 하나. 표식은 email_threads.reply_task_id(없는 업무 = 없음). 업무 표시는 created_via 'mail_reply'.
//   · 담당 정본 = 열린 답변 업무의 담당자. email_thread_participants.is_assigned 는 그 거울(«담당» 폴더·대시보드가 읽는다).
//     거울을 맞추는 길은 둘 — 메일에서 지정(assignReply) · 업무에서 담당 변경(task_actions.afterAssigneeChange → mirrorAssigneeFromTask).
//   · 업무를 만들고·바꾸고·닫는 것은 전부 행동 계층(task_actions) 문으로만 — 권한·이력·알림·방송이 화면과 같다.
//   · 답장하면 완료 — 보낸 사람 = 담당자일 때만(complete 가 담당자 외를 막는다). 남이 답했으면 업무에 댓글 한 줄.
//   · «답변 불필요»·«확인 완료» = 업무 취소. 권한이 없으면 아무것도 안 한다(메일 동작은 성공).
//   · 메일 동작이 이 훅 때문에 실패하면 안 된다 — 호출부는 메일 쪽을 먼저 끝내고 이 함수를 try/catch 로 부른다.
const { Op } = require('sequelize');

const CLOSED = ['completed', 'canceled'];

function userActor(userId, platformRole = null) {
  return { kind: 'user', userId: Number(userId), onBehalfOfUserId: null, platformRole };
}

async function openReplyTask(thread) {
  if (!thread || !thread.reply_task_id) return null;
  const { Task } = require('../models');
  const t = await Task.findOne({ where: { id: thread.reply_task_id, business_id: thread.business_id } });
  return t && !CLOSED.includes(t.status) ? t : null;
}

/** 이 사람이 이 메일 계정을 볼 수 있나 — 개인 계정은 주인만, 공용은 멤버 이상 ∧ 접근 가능한 계정(mailIdentity). */
async function canSeeAccount(businessId, account, userId) {
  if (!userId) return false;
  if (account.owner_user_id) return Number(account.owner_user_id) === Number(userId);
  const { getUserScope, isMemberOrAbove } = require('../middleware/access_scope');
  const scope = await getUserScope(userId, businessId);
  if (!isMemberOrAbove(scope)) return false;
  const { accessibleAccountIds } = require('./mailIdentity');
  return (await accessibleAccountIds(businessId, userId)).includes(account.id);
}

/** 담당 거울 — 한 명만. userId null = 해제. */
async function setAssignedMirror(threadId, userId) {
  const { EmailThreadParticipant } = require('../models');
  await EmailThreadParticipant.update({ is_assigned: false }, { where: { thread_id: threadId, is_assigned: true } });
  if (userId) {
    const [p] = await EmailThreadParticipant.findOrCreate({ where: { thread_id: threadId, user_id: userId }, defaults: { thread_id: threadId, user_id: userId } });
    if (!p.is_assigned) await p.update({ is_assigned: true });
  }
}

function emitMailSignal(thread, account, payload) {
  const io = global.__planqIo;
  if (!io) return;
  const room = account && account.owner_user_id ? `user:${account.owner_user_id}` : `business:${thread.business_id}`;
  io.to(room).emit('mail:updated', { thread_id: thread.id, business_id: thread.business_id, ...payload });
}

async function replyTaskTitle(thread, lang) {
  const subj = String(thread.subject || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (lang === 'en') return `Reply to email: ${subj || '(no subject)'}`;
  return `메일 답변: ${subj || '(제목 없음)'}`;
}

/**
 * 메일에서 «답변 담당» 지정 — 열린 답변 업무가 있으면 그 업무의 담당을 바꾸고, 없으면 새로 만든다.
 * @returns {{ ok:true, data:{ assignee_user_id, task_id, task_created, task_error? } } | { ok:false, code, http }}
 */
async function assignReply({ actor, businessId, thread, account, userId }) {
  const target = userId ? Number(userId) : null;
  if (target && !(await canSeeAccount(businessId, account, target))) return { ok: false, code: 'assignee_cannot_see_mail', http: 400 };

  const taskActions = require('./actions/task_actions');
  const open = await openReplyTask(thread);

  if (open) {
    // 담당 정본 = 업무. 업무 담당을 바꿀 권한이 없으면 메일 담당도 바꾸지 않는다(두 값이 갈라지지 않게).
    if (open.assignee_id !== target) {
      const r = await taskActions.reassign(open, actor, { assigneeId: target });
      if (!r.ok) return { ok: false, code: r.http === 403 ? 'cannot_reassign_task' : r.code, http: r.http || 400 };
    }
    await setAssignedMirror(thread.id, target);   // reassign 의 afterAssigneeChange 도 맞추지만 같은 사람이면 안 부른다
    return { ok: true, data: { assignee_user_id: target, task_id: open.id, task_created: false } };
  }

  await setAssignedMirror(thread.id, target);
  if (!target) return { ok: true, data: { assignee_user_id: null, task_id: null, task_created: false } };

  // 새 답변 업무 — 화면 업무 추가와 같은 문(createTask). 담당 ≠ 나 이면 곧 «요청»(요청 알림 한 통이 간다).
  const { Business } = require('../models');
  const biz = await Business.findByPk(businessId, { attributes: ['timezone'] });
  const { todayInTz } = require('../utils/datetime');
  const { recipientLang } = require('./notifyTitle');
  const base = {
    businessId,
    title: await replyTaskTitle(thread, await recipientLang(target)),
    assigneeId: target,
    dueDate: todayInTz((biz && biz.timezone) || 'Asia/Seoul'),
    clientId: thread.client_id || null,
    emailThreadId: thread.id,
    sourceEmailMessageId: thread.last_inbound_message_id || null,
    createdVia: 'mail_reply',
    // 개인 메일 계정 = «나만 보기»(개인 메일 제목이 팀 업무 목록에 나가지 않게). 담당도 주인뿐이다(위 canSeeAccount).
    ...(account.owner_user_id ? { vlevel: 'L1' } : {}),
  };
  // 요청자 자동 컨펌자는 붙이지 않는다 — 답장이 곧 결과물이라 답장하면 닫힌다(Fable 결정 · task_actions opts.autoReviewer).
  const createOpts = { autoReviewer: false };
  let r = await taskActions.createTask(actor, { ...base, projectId: thread.project_id || null }, createOpts);
  // 볼 수 없는 프로젝트에 걸린 메일이면 프로젝트 없이 만든다 — 프로젝트 때문에 담당 지정이 막히면 안 된다.
  if (!r.ok && thread.project_id && /project/.test(String(r.code))) r = await taskActions.createTask(actor, { ...base, projectId: null }, createOpts);
  if (!r.ok) {
    console.warn('[mailReplyTask] createTask', r.code);
    return { ok: true, data: { assignee_user_id: target, task_id: null, task_created: false, task_error: r.code } };
  }
  const task = r.data && (r.data.task || r.data);
  const { EmailThread } = require('../models');
  await EmailThread.update({ reply_task_id: task.id }, { where: { id: thread.id, business_id: businessId } });
  return { ok: true, data: { assignee_user_id: target, task_id: task.id, task_created: true } };
}

/** 업무 쪽에서 담당이 바뀌면 메일 거울을 맞춘다 — task_actions.afterAssigneeChange 가 부른다. */
async function mirrorAssigneeFromTask(task) {
  const { EmailThread, EmailAccount } = require('../models');
  const thread = await EmailThread.findOne({ where: { reply_task_id: task.id, business_id: task.business_id }, attributes: ['id', 'business_id', 'account_id'] });
  if (!thread) return;
  await setAssignedMirror(thread.id, task.assignee_id || null);
  const account = await EmailAccount.findByPk(thread.account_id, { attributes: ['id', 'owner_user_id'] });
  emitMailSignal(thread, account, { assignee_user_id: task.assignee_id || null });
}

/**
 * 답장이 나갔다 — 보낸 사람 = 담당자면 업무 완료, 아니면 업무에 댓글 한 줄.
 *   viaImapCopy: 업체 보낸편지함 사본으로 안 것 — 업무가 생긴 뒤이고 마지막 받은 메일보다 뒤일 때만(백필 사본이 새 업무를 닫지 않게).
 */
async function onReplySent({ thread, senderUserId, sentAt = null, keepReplyNeeded = false, viaImapCopy = false }) {
  if (keepReplyNeeded || !senderUserId) return null;
  const task = await openReplyTask(thread);
  if (!task) return null;
  if (viaImapCopy) {
    const at = sentAt ? new Date(sentAt).getTime() : 0;
    if (!at || at < new Date(task.created_at || task.createdAt || 0).getTime()) return null;
    if (thread.last_inbound_message_id) {
      const { EmailMessage } = require('../models');
      const lastIn = await EmailMessage.findByPk(thread.last_inbound_message_id, { attributes: ['sent_at'] });
      if (lastIn && lastIn.sent_at && at <= new Date(lastIn.sent_at).getTime()) return null;
    }
  }
  const taskActions = require('./actions/task_actions');
  if (Number(task.assignee_id) === Number(senderUserId)) {
    const r = await taskActions.complete(task, userActor(senderUserId));
    if (r.ok) return 'completed';
    // 컨펌자가 있는 업무 등 — 완료는 사람이 한다. 사실만 남긴다.
  }
  const { recipientLang } = require('./notifyTitle');
  const lang = await recipientLang(task.assignee_id || senderUserId);
  await taskActions.createComment(userActor(senderUserId), task, {
    content: lang === 'en' ? 'Replied to the email.' : '메일에 답장을 보냈습니다.',
    visibility: 'internal',
  }).catch(() => null);
  return 'commented';
}

/** «답변 불필요»·«확인 완료» — 열린 답변 업무를 취소. 권한이 없으면 그대로 둔다. */
async function onReplyNotNeeded({ thread, actorUserId, platformRole = null, reason }) {
  const task = await openReplyTask(thread);
  if (!task) return null;
  const r = await require('./actions/task_actions').cancel(task, userActor(actorUserId, platformRole), { reason });
  return r.ok ? 'canceled' : null;
}

module.exports = { assignReply, mirrorAssigneeFromTask, onReplySent, onReplyNotNeeded, canSeeAccount, openReplyTask };
