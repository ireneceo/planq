// services/focusBroadcast.js — 포커스 전이를 본인의 다른 기기에 알린다.
//   (라우트가 얇아야 하는 이유도 있지만, 같은 이벤트를 다른 경로에서도 쏘게 되기 때문이다.)
//   ★ 라우트에서 빼낸 이유는 크기만이 아니다 — cron·워크플로 같은 다른 경로에서도 같은
//     이벤트를 쏠 일이 생기고, 그때 사본을 만들면 룸 이름이 갈라진다
//     (attendanceTransition 이 broadcast 를 서비스에 둔 것과 같은 이유).
const { Task } = require('../models');

// ★ 2026-09-07 — 포커스(업무 시작·일시정지·재개·종료)를 **본인의 다른 기기**에 즉시 알린다.
//   Irene: "태블릿에서 좌측메뉴의 업무재개를 눌렀는데 pwa 데스크탑앱에서 바로 적용이 안되는데
//           시차가 1분은 있어보여."
//   원인: FocusWidget 에 소켓 리스너가 **아예 없었다** — 30초 폴링 + 같은 탭 CustomEvent 뿐이라
//   다른 기기에서는 최대 30초(폴링이 어긋나면 그 이상) 옛 상태가 남았다.
//   근태(attendance:updated)는 같은 계열인데 이미 broadcast 가 있어 529ms 에 반영된다(실측) —
//   포커스만 빠져 있었다. CLAUDE.md 운영 안정성 §16 (b).
//
//   ★ 룸은 `user:{id}` 다. 포커스 세션은 **개인 자원**이라 워크스페이스로 뿌리면
//     "누가 무슨 업무를 하는지" 가 권한 검사 없이 전파된다(근태가 수치를 안 싣는 것과 같은 이유).
//     `user:{id}` 는 연결 시 서버가 자동 join 한다(server.js:223).
function broadcastFocus(req, userId, payload) {
  try {
    const io = req.app.get('io');
    if (io) io.to(`user:${userId}`).emit('focus:updated', payload || {});
  } catch (e) { console.warn('[focus broadcast]', e.message); }
}

// 운영 #38: 포커스 측정시간이 actual_hours 에 반영된 직후 task:updated broadcast.
// focus 라우트는 세션만 응답하므로, '실제' 시간(task.actual_hours)이 Q Task 리스트·드로어에
// 새로고침 없이 보이려면 §16 (b) broadcast 가 필요 (start/pause/stop recompute 직후 호출).
async function broadcastTaskUpdate(req, taskId) {
  if (!taskId) return;
  try {
    const io = req.app.get('io');
    if (!io) return;
    const t = await Task.findByPk(taskId);
    if (!t) return;
    // #277 — 표시명 포함 직렬화 단일 지점 (raw toJSON 은 사람 정보가 없다).
    const { serializeTaskForBroadcast } = require('../services/taskBroadcast');
    const data = (await serializeTaskForBroadcast(t.id, t.business_id)) || t.toJSON();
    if (t.project_id) io.to(`project:${t.project_id}`).emit('task:updated', data);
    io.to(`business:${t.business_id}`).emit('task:updated', data);
  } catch (e) { console.warn('[focus broadcastTaskUpdate]', e.message); }
}

module.exports = { broadcastFocus, broadcastTaskUpdate };

