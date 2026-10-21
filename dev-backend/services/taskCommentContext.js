// 업무 댓글이 «어떤 상황에서» 남겨졌는지 — 확인 요청 · 승인 · 수정 요청.
// Irene 2026-10-21: "확인요청이나 승인, 수정요청하면서 남겨지는 댓글에는 그 앞에 아이콘 표시 … 어떤 상황에 입력한 건지 알면"
//
// 승인·수정 요청은 댓글 행 자체가 안다(kind system_approve / system_revision).
// 확인 요청 메모는 kind 'user' 로 저장된다(task_actions.submitReview — 새 ENUM 값은 운영 ALTER 가 필요해서).
// 그래서 그 댓글은 **같은 사람의 review_submit 이력**과 짝지어 판정한다:
//   이력 1건 ↔ 같은 작성자의 kind 'user' 댓글 1건 — 내용이 note 와 같은 것 먼저, 없으면(편집됨) 시각이 가장 가까운 것.
// 옛 댓글에도 그대로 붙는다(이력은 2026-09 #271 부터 note 를 같이 남겼다).

const { Op } = require('sequelize');
const { TaskStatusHistory } = require('../models');

const WINDOW_MS = 15 * 1000;

const KIND_CONTEXT = { system_approve: 'approve', system_revision: 'revision' };

const atOf = (c) => new Date(c.created_at || c.createdAt || 0).getTime();

/**
 * 댓글 JSON 배열에 `context`('submit'|'approve'|'revision'|null)를 채운다(제자리 수정).
 * 여러 업무의 댓글이 섞여 있어도 된다(task_id 로 가른다).
 */
async function annotateCommentContext(comments) {
  if (!Array.isArray(comments) || comments.length === 0) return comments;
  for (const c of comments) c.context = KIND_CONTEXT[c.kind] || null;

  const candidates = comments.filter((c) => c.kind === 'user' && c.user_id);
  if (candidates.length === 0) return comments;
  const taskIds = [...new Set(candidates.map((c) => c.task_id))];
  const submits = await TaskStatusHistory.findAll({
    where: { task_id: { [Op.in]: taskIds }, event_type: 'review_submit', note: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
    attributes: ['task_id', 'actor_user_id', 'note', 'createdAt'],
    raw: true,
  });
  // ① 내용이 이력 note 와 같은 댓글을 먼저 짝짓는다(시각은 초 단위라 같은 초의 일반 댓글과 구별이 안 된다).
  // ② 남은 이력만 시각으로 — 편집해서 내용이 달라진 확인 요청 메모. 메모는 전이 **뒤에** 만들어지므로 이력보다 앞선 글은 뺀다.
  const pick = (h, test) => {
    const hAt = new Date(h.createdAt).getTime();
    let best = null; let bestGap = WINDOW_MS + 1;
    for (const c of candidates) {
      if (c.context || c.task_id !== h.task_id || c.user_id !== h.actor_user_id) continue;
      const gap = atOf(c) - hAt;
      if (gap < -1000 || gap > WINDOW_MS || !test(c)) continue;
      // 같은 초면 나중 글(id 큰 것) — 메모는 전이 직후에 쓰인다
      if (Math.abs(gap) < bestGap || (best && Math.abs(gap) === bestGap && c.id > best.id)) { best = c; bestGap = Math.abs(gap); }
    }
    return best;
  };
  const left = [];
  for (const h of submits) {
    const note = String(h.note).trim();
    const hit = pick(h, (c) => String(c.content || '').trim() === note);
    if (hit) hit.context = 'submit'; else left.push(h);
  }
  for (const h of left) {
    const hit = pick(h, () => true);
    if (hit) hit.context = 'submit';
  }
  return comments;
}

module.exports = { annotateCommentContext };
