// services/clientResponse.js — 고객 라우트 응답·실시간 공용 조각 (routes/clients.js · routes/client_invites.js 가 같이 쓴다)
//   두 라우트 파일이 각자 베끼면 비밀 필드 목록·관계 판정이 한쪽만 고쳐진다.
//
// ★ 2026-09-13 — **초대 토큰은 응답에 실리지 않는다.** 이 토큰은 초대 링크의 자격증명이다
//   (`POST /api/auth/register` 가 이 값으로 "그 고객으로" 계정을 붙인다). 열거식이라 컬럼이 늘면 샌다 —
//   health-check `--category=secrets` 가 응답 원문으로 같이 지킨다.
// N+38 — 실시간 동기화 (CLAUDE.md 운영 안정성 16번 박제).
function broadcastClient(req, client, event = 'client:updated') {
  const io = req.app.get('io');
  if (!io) return;
  // 신호만(0-C C-2) — 받는 화면은 id 로 다시 읽는다. 통째로 보내면 자격증명·영업 메모가 방 전원에게 간다.
  const bizId = client.business_id || Number(req.params.businessId);
  const data = { id: client.id, business_id: bizId };
  if (bizId) io.to(`business:${bizId}`).emit(event, data);
}


const CLIENT_SECRET_FIELDS = ['invite_token'];
function stripClientSecrets(json) {
  if (!json || typeof json !== 'object') return json;
  for (const k of CLIENT_SECRET_FIELDS) delete json[k];
  return json;
}

// 관계 축 판정을 응답에 싣는다 — 화면은 이 값만 본다(services/clientAccess 단일 원천, Q sale 목록과 같은 값).
//   ★ 원본 행(인스턴스)에서 판정한다 — toJSON 뒤 객체에는 invite_token 이 없다.
function withRelation(row, json) {
  const { accessKindOf, canInviteClient, emailEditable } = require('./clientAccess');
  json.access_kind = accessKindOf(row);
  json.can_invite = canInviteClient(row);
  json.email_editable = emailEditable(row);
  return json;
}


module.exports = { broadcastClient, stripClientSecrets, withRelation, CLIENT_SECRET_FIELDS };
