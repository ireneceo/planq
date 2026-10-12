// 프로젝트 실시간 방 — 직원 방과 고객 방을 가른다 (2026-10-09 보안점검).
//
// 왜: `project:<id>` 에는 멤버와 **프로젝트 고객**이 함께 들어 있었다. 그런데 이 방으로
//   업무 행 전체(공수·태그·중요도·공유 비밀번호 해시)·내부 메모·이슈·업무 후보·프로젝트 행 전체가
//   그대로 나갔다. REST 는 고객을 거르는데 방송은 거르지 않았다 — 가장 먼저 도착하는 문이 열려 있었다.
//
// 계약:
//   - 멤버는 `project:<id>`, 고객은 `project:<id>:client` 에 든다(server.js join:project).
//   - 프로젝트 방송은 **반드시 emitProject** 로 보낸다. 직원 방에는 원본, 고객 방에는
//     CLIENT_VIEW 에 등록된 사건만 고객용으로 바꿔 보낸다. 등록 안 된 사건은 고객에게 가지 않는다
//     (모르는 것은 막는 쪽 — 새 사건을 만들고 등록을 잊어도 새지 않는다).
//   - `io.to(\`project:...\`)` 를 직접 쓰지 않는다(가드 `--category=projectroom`).
'use strict';

const { serializeTaskForClient } = require('../utils/taskClientView');

const signal = (p) => (p && typeof p === 'object'
  ? { id: p.id ?? null, business_id: p.business_id ?? null, project_id: p.project_id ?? null }
  : p);

// 고객 업무 보기 — 내부 공수·태그·공유 열쇠는 taskClientView 한 곳이 뺀다.
const taskForClient = (p) => serializeTaskForClient(p);

const CLIENT_VIEW = {
  'task:new': taskForClient,
  'task:updated': taskForClient,
  'task:deleted': signal,
  'inbox:refresh': signal,
  'project:updated': signal,     // 고객 화면은 다시 읽는다 — 프로젝트 행(계약 금액·전략)을 싣지 않는다
  'post:new': signal, 'post:updated': signal, 'post:deleted': signal,
  'kb:new': signal, 'kb:updated': signal, 'kb:deleted': signal,
  'file:new': signal, 'file:updated': signal, 'file:deleted': signal,
};

// «내부 업무»(2026-10-12) — 고객 방에는 행을 싣지 않는다. 바뀐 업무가 내부면 삭제 신호만 보내
//   고객 화면에서 사라지게 한다. 이름이 박힌 관계자 고객은 다시 읽으면 REST 가 돌려준다.
//   ★ 판정은 «값이 internal» 이다 — 행 전체 방송(serializeTaskForBroadcast)은 이 칸을 늘 싣는다.
//     값을 안 실은 부분 방송(워크스트림 삭제의 {id, workstream_id})은 제목이 없어 종전대로 보낸다
//     (그걸 삭제 신호로 바꾸면 일반 업무가 고객 화면에서 사라진다). 새 부분 방송에 제목을 실으면 칸도 같이 싣는다.
const TASK_ROW_EVENTS = new Set(['task:new', 'task:updated']);

function emitProject(io, projectId, event, payload) {
  if (!io || !projectId) return;
  io.to(`project:${projectId}`).emit(event, payload);
  if (TASK_ROW_EVENTS.has(event) && payload && payload.security_level === 'internal') {
    io.to(`project:${projectId}:client`).emit('task:deleted', signal(payload));
    return;
  }
  const toClient = CLIENT_VIEW[event];
  if (toClient) io.to(`project:${projectId}:client`).emit(event, toClient(payload));
}

module.exports = { emitProject, CLIENT_VIEW };
