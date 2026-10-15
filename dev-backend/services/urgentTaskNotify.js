// 긴급 업무요청 알림 — **한 문** (2026-10-15, Irene: *"업무요청 시 긴급으로 선택한 업무요청은 … 무조건 보게 하는 거야"*)
//
// 언제 보내나 (전이에만 — 같은 상태를 다시 저장해도 다시 울리지 않는다)
//   ① 긴급으로 만든 요청 업무           — task_actions.afterCreate
//   ② 미확인 요청을 긴급으로 올렸을 때  — PUT /api/tasks/:id · task_actions.updateFields (prevPriority !== 'urgent')
//   ③ 미확인 긴급 요청의 담당자를 바꿨을 때 — task_actions.afterAssigneeChange (새 담당자에게)
// 받는 사람 = 담당자(요청을 받은 사람). 담당자가 바꾼 본인이면 보내지 않는다(본인 업무는 noise).
// ①·③ 은 원래 나가던 «새 업무 배정» 알림 **대신** 이것을 보낸다 — 같은 사건에 두 통이면 둘 다 덜 보인다.
//
// 무엇이 다른가 (notify 의 `urgent:true` 가 채널마다 강조로 바뀐다 — routes/notifications.js)
//   · 제목 앞 «[긴급]»(수신자 언어) · 푸시 tag 를 업무마다 따로(다른 알림에 덮이지 않게)
//   · 웹/PWA: 사용자가 닫을 때까지 남는다(requireInteraction) · iOS: time-sensitive(집중 모드 — 앱 엔타이틀먼트가 있을 때만 적용, 없으면 보통 알림)
//   · Android: 최고 우선순위·잠금화면 공개 · 앱 안 토스트: 빨간 띠 · 팝아웃 업무리스트: 맨 위 «긴급 요청» 띠(my-week urgent_requests)
//
// «미확인 요청» 술어는 확인필요 ① 버킷(routes/dashboard.js unconfirmed)과 같은 선이다 — 한쪽만 바꾸지 말 것.
const UNACKED_STATUSES = ['not_started', 'waiting', 'in_progress'];

function isUnackedRequest(task) {
  if (!task || !task.assignee_id || !task.request_by_user_id) return false;
  if (Number(task.request_by_user_id) === Number(task.assignee_id)) return false;
  if (task.request_ack_at) return false;
  return UNACKED_STATUSES.includes(task.status);
}

function isUrgentUnacked(task) {
  return !!task && task.priority_level === 'urgent' && isUnackedRequest(task);
}

// 같은 업무·같은 사람에게 짧은 간격으로 두 번 울리지 않는다(긴급 ↔ 보통을 오가는 토글 남용 방지).
const RECENT_MS = 10 * 60 * 1000;
const recent = new Map();   // `${taskId}:${userId}` → ts
function seenRecently(key) {
  const now = Date.now();
  const ts = recent.get(key);
  if (ts && now - ts < RECENT_MS) return true;
  recent.set(key, now);
  if (recent.size > 2000) for (const [k, v] of recent) if (now - v > RECENT_MS) recent.delete(k);
  return false;
}

/**
 * 긴급 요청 알림 1건. 보냈으면 true(호출부는 그 경우 보통 «배정» 알림을 생략한다).
 * @param {object} task Task 인스턴스(현재 값)
 * @param {object} o { actorUserId, wsName? }
 */
async function notifyUrgentRequest(task, { actorUserId, wsName } = {}) {
  if (!isUrgentUnacked(task)) return false;
  const to = Number(task.assignee_id);
  if (!to || to === Number(actorUserId)) return false;
  if (seenRecently(`${task.id}:${to}`)) return true;   // 방금 보냈다 — 보통 알림도 다시 보내지 않는다
  const { notify } = require('../routes/notifications');
  const { buildTitle, recipientLang } = require('./notifyTitle');
  let workspaceName = wsName;
  if (workspaceName === undefined) {
    try {
      const { Business } = require('../models');
      const biz = await Business.findByPk(task.business_id, { attributes: ['name', 'brand_name'] });
      workspaceName = biz?.brand_name || biz?.name || null;
    } catch { workspaceName = null; }
  }
  const lang = await recipientLang(to);
  const mark = lang === 'en' ? '[Urgent] ' : '[긴급] ';
  const due = task.due_date ? String(task.due_date).slice(0, 10) : '';
  notify({
    userId: to,
    businessId: task.business_id,
    eventKind: 'task',
    title: mark + buildTitle({ feature: 'task', action: 'task_urgent_request', subject: `"${task.title}"`, lang }),
    body: `"${task.title}"${due ? (lang === 'en' ? ` · due ${due}` : ` · 마감 ${due}`) : ''}`,
    link: `${process.env.APP_URL || 'https://dev.planq.kr'}/tasks?task=${task.id}`,
    ctaLabel: lang === 'en' ? 'View task' : '업무 보기',
    workspaceName,
    tag: `task-urgent:${task.id}`,
    actorUserId,
    entityType: 'task',
    entityId: task.id,
    urgent: true,
  }).catch((e) => console.warn('[urgentTaskNotify]', e.message));
  return true;
}

module.exports = { notifyUrgentRequest, isUrgentUnacked, isUnackedRequest, UNACKED_STATUSES };
