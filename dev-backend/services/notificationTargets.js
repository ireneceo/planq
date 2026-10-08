// services/notificationTargets.js — 알림이 가리키는 대상이 지워졌는지 판정 (routes/notifications.js 목록이 쓴다)
// ★ 대상이 지워진 알림 (2026-10-07 순찰 실측) — 업무를 지우면 그 업무의 알림은 남는데, 누르면 «찾을 수 없음» 상세가 떴다.
//   사용자에게는 «알림을 눌렀더니 고장» 이다. 목록에서 미리 표시(`target_missing`)하고 화면은 누를 때 이동하지 않는다.
//   알림 행을 지우지 않는 이유: 무엇이 있었는지(누가 무엇을 요청했나)는 기록으로 남아야 한다.
//   판정은 종류별 id 를 모아 **한 번씩** 존재만 센다(목록 100건 = 쿼리 최대 5번).
const GONE_KINDS = {
  task: { model: 'Task', link: /[?&]task=(\d+)/ },
  calendar_event: { model: 'CalendarEvent', link: /[?&]event=(\d+)/ },
  email_thread: { model: 'EmailThread', link: /[?&]thread=(\d+)/ },
  invoice: { model: 'Invoice', link: /[?&]invoice=(\d+)/ },
  conversation: { model: 'Conversation', link: /^\/talk(?:\/(\d+)|\?(?:.*&)?conv=(\d+))/ },
};
function targetOf(n) {
  if (n.entity_type && GONE_KINDS[n.entity_type] && n.entity_id) return { kind: n.entity_type, id: Number(n.entity_id) };
  const link = n.link || '';
  // entity_type 없이 링크만 있는 옛 알림 — 업무 링크가 대부분이다(dev 실측 313건)
  if (/^\/tasks\b/.test(link)) { const m = link.match(GONE_KINDS.task.link); if (m) return { kind: 'task', id: Number(m[1]) }; }
  // 채팅 링크는 두 모양 — /talk/:id(옛) · /talk?conv=:id(utils/notification_link.js 가 만드는 지금 모양)
  if (/^\/talk\b/.test(link)) { const m = link.match(GONE_KINDS.conversation.link); if (m) return { kind: 'conversation', id: Number(m[1] || m[2]) }; }
  return null;
}
async function markGoneTargets(list) {
  const models = require('../models');
  const byKind = {};
  for (const n of list) { const t = targetOf(n); if (t) (byKind[t.kind] = byKind[t.kind] || new Set()).add(t.id); }
  const alive = {};
  for (const [kind, ids] of Object.entries(byKind)) {
    const M = models[GONE_KINDS[kind].model];
    if (!M) continue;   // 모델이 없으면 판정하지 않는다(있다고 본다 — 안 되는 링크를 «지워짐» 으로 말하는 쪽이 더 나쁘다)
    try {
      const rows = await M.findAll({ where: { id: [...ids] }, attributes: ['id'], raw: true });
      alive[kind] = new Set(rows.map((r) => Number(r.id)));
    } catch { /* 판정 실패 = 있다고 본다 */ }
  }
  for (const n of list) {
    const t = targetOf(n);
    if (t && alive[t.kind] && !alive[t.kind].has(t.id)) n.target_missing = true;
  }
}

module.exports = { markGoneTargets, targetOf };
