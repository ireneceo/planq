// 파일 실시간 반영 — **단일 원천.**
//
// CLAUDE.md 운영 안정성 §16: 데이터가 바뀌면 그 화면을 열고 있는 사람에게 즉시 보여야 한다.
//   파일 생성/변경은 `business:<id>` (+ 프로젝트 소속이면 `project:<id>`) room 으로 방송한다.
//
// ★ 운영 #378 — 여태 이 함수가 routes/files.js **안에만** 있어서, 다른 라우트에서 만든 파일은
//   방송이 없었다. 실제로 Q docs 본문 이미지(`/api/posts/editor-image`)가 그랬다 —
//   파일은 만들어지는데 파일 목록을 열고 있어도 새로고침 전에는 안 보였다.
//   Irene: "통일해서 맞춰서 일반적인 기능으로 해야 해."
//   새로 파일을 만드는 라우트는 여기를 부른다. 베껴 두면 반드시 갈라진다.
function broadcastFile(req, file, event = 'file:updated') {
  const io = req.app.get('io');
  if (!io) return;
  const data = file.toJSON ? file.toJSON() : file;
  if (file.business_id) io.to(`business:${file.business_id}`).emit(event, data);
  if (file.project_id) io.to(`project:${file.project_id}`).emit(event, data);
}

module.exports = { broadcastFile };
