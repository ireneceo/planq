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

// ─── 수정 요청의 «위 댓글» (#466 · 2026-10-29 Fable 설계) ───
// 컨펌자가 이번 라운드에 이미 댓글로 고칠 점을 적었으면 사유를 비워 보낼 수 있다.
// 가리키는 댓글은 **저장하지 않고 이 술어 하나로 계산한다** — 요청할 때(task_actions.requestRevision)·
// 상세가 버튼을 켤 때(routes/tasks GET /:id)·스레드에 «위 댓글 참고» 를 그릴 때(annotateCommentContext)가 같은 함수.
//   후보 = 같은 업무 · 그 컨펌자 · kind 'user' · 이번 라운드(review_submit) 이후 · 수정 요청 시각 이전 ·
//          수정 요청 댓글을 볼 수 있는 사람은 반드시 볼 수 있는 범위(고객 컨펌자 → shared, 내부 → internal·shared, L1·L2 제외).
//   여러 개면 가장 늦은 1건.
function refVisible(c, clientReviewer) {
  if (c.vlevel === 'L1' || c.vlevel === 'L2') return false;
  if (clientReviewer) return c.visibility === 'shared';
  return c.visibility === 'internal' || c.visibility === 'shared';
}

function pickRevisionRef({ comments, taskId, reviewerUserId, roundStartAt, beforeAt, clientReviewer }) {
  if (roundStartAt == null || !Array.isArray(comments)) return null;
  const start = new Date(roundStartAt).getTime();
  const before = new Date(beforeAt).getTime();
  let best = null;
  for (const c of comments) {
    if (Number(c.task_id) !== Number(taskId) || Number(c.user_id) !== Number(reviewerUserId)) continue;
    if (c.kind !== 'user' || !String(c.content || '').trim()) continue;
    const at = atOf(c);
    if (at < start || at > before) continue;
    if (!refVisible(c, clientReviewer)) continue;
    if (!best || at > atOf(best) || (at === atOf(best) && Number(c.id) > Number(best.id))) best = c;
  }
  return best;
}

/** 지금 이 컨펌자가 사유를 비우면 가리킬 댓글(없으면 null) — DB 에서 읽어 pickRevisionRef 에 넘긴다. */
async function findRevisionRef({ taskId, reviewerUserId, clientReviewer, beforeAt = new Date(), transaction }) {
  const { TaskComment } = require('../models');
  const last = await TaskStatusHistory.findOne({
    where: { task_id: taskId, event_type: 'review_submit', createdAt: { [Op.lte]: beforeAt } },
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    attributes: ['createdAt'], transaction,
  });
  if (!last) return null;
  const rows = await TaskComment.findAll({
    where: { task_id: taskId, user_id: reviewerUserId, kind: 'user', createdAt: { [Op.gte]: last.createdAt } },
    attributes: ['id', 'task_id', 'user_id', 'kind', 'content', 'visibility', 'vlevel', 'createdAt'],
    raw: true, transaction,
  });
  return pickRevisionRef({ comments: rows, taskId, reviewerUserId, roundStartAt: last.createdAt, beforeAt, clientReviewer });
}

/**
 * 댓글 JSON 배열에 `context`('submit'|'approve'|'revision'|null)를 채운다(제자리 수정).
 * 여러 업무의 댓글이 섞여 있어도 된다(task_id 로 가른다).
 */
async function annotateCommentContext(comments) {
  if (!Array.isArray(comments) || comments.length === 0) return comments;
  for (const c of comments) c.context = KIND_CONTEXT[c.kind] || null;
  await annotateRevisionRefs(comments);

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

/** 사유를 비운 수정 요청 댓글에 ref_comment_id(가리키는 댓글 · 없으면 null)를 싣는다 — 받은 배열 안에서만 고른다. */
async function annotateRevisionRefs(comments) {
  const blanks = comments.filter((c) => c.kind === 'system_revision' && !String(c.content || '').trim());
  if (blanks.length === 0) return;
  const taskIds = [...new Set(blanks.map((c) => c.task_id))];
  const submits = await TaskStatusHistory.findAll({
    where: { task_id: { [Op.in]: taskIds }, event_type: 'review_submit' },
    attributes: ['task_id', 'createdAt'],
    raw: true,
  });
  for (const r of blanks) {
    const at = atOf(r);
    let start = null;
    for (const h of submits) {
      const hAt = new Date(h.createdAt).getTime();
      if (h.task_id === r.task_id && hAt <= at && (start == null || hAt > start)) start = hAt;
    }
    const ref = pickRevisionRef({
      comments, taskId: r.task_id, reviewerUserId: r.user_id,
      roundStartAt: start, beforeAt: at, clientReviewer: r.visibility === 'shared',
    });
    r.ref_comment_id = ref ? ref.id : null;
  }
}

module.exports = { annotateCommentContext, pickRevisionRef, findRevisionRef };
