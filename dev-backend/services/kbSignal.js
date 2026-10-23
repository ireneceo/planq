// services/kbSignal.js — Q info 실시간 신호 **한 문**(2026-10-23)
//   routes/kb.js broadcastKb 와 services/actions/kb_actions signalKb 가 같은 몸통을 베껴 두고 있었다 — 고객 신호를
//   한쪽에만 넣으면 AI·화면 생성 중 한 길로 만든 자료는 고객 홈에 안 뜬다. 그래서 몸통을 여기 하나로 모았다.
//
// 신호만(id·소속) — 행 전체를 뿌리면 «나만 보기» 문서 본문이 멤버 전원·프로젝트 고객에게 갔다(2026-09-27 점검).
// 고객 범위 자료는 연결 고객 계정의 개인 방(user:<id>)에도 보낸다(고객 홈 «자료» 칸, docs/CLIENT_QINFO_VIEW_DESIGN.md ⑤) —
//   고객은 business 방에 못 들어온다. `prev` = 바뀌기 전 {scope, client_id, client_ids}: 범위가 좁아졌을 때
//   (고객 해제·다른 고객으로) 빠진 고객도 다시 읽어 화면에서 지운다.
function clientIdsOf(d) {
  const ids = [];
  if (!d || d.scope !== 'client') return ids;
  if (d.client_id != null) ids.push(Number(d.client_id));
  if (Array.isArray(d.client_ids)) d.client_ids.forEach((x) => ids.push(Number(x)));
  return ids;
}

function emitKb(io, doc, event, prev = null) {
  if (!io || !doc) return;
  const data = { id: doc.id, business_id: doc.business_id, project_id: doc.project_id || null };
  if (doc.business_id) io.to(`business:${doc.business_id}`).emit(event, data);
  if (doc.project_id) require('./projectRoom').emitProject(io, doc.project_id, event, data);
  const ids = [...new Set([...clientIdsOf(doc), ...clientIdsOf(prev)])].filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length || !doc.business_id) return;
  const { Client } = require('../models');
  Client.findAll({ where: { business_id: doc.business_id, id: ids, status: 'active' }, attributes: ['user_id'] })
    .then((rows) => rows.forEach((c) => {
      if (c.user_id) io.to(`user:${c.user_id}`).emit(event, { id: doc.id, business_id: doc.business_id });
    }))
    .catch(() => {});
}

// 바뀌기 전 고객 범위 스냅샷 — 수정 전에 떠 둔다
const clientScopeSnap = (doc) => (doc ? { scope: doc.scope, client_id: doc.client_id, client_ids: doc.client_ids } : null);

module.exports = { emitKb, clientScopeSnap };
