// 시연 영상 요청 — 상태를 바꾸는 문은 이 파일 하나다 (docs/DEMO_VIDEO_DESIGN.md §20.3).
//   planned →(claim) producing →(완료) awaiting_link →(링크·발행, E′) published
//   producing →(관문 걸림·승인 대기) needs_review →(사람: 고침/그대로) planned(맨 위) | archived
//   producing →(실패, 3번 전) planned(맨 위) | (3번째) failed
//   어느 상태든 →(보관) archived  — published 의 발행 취소(미발송 SNS 취소)는 E′ 에서 이 파일에 더한다.
//   매 전이: writeAudit(actor = 관리자 id, 작업자는 null + by:'video-worker') — 같은 트랜잭션.
const { VideoProject, VideoJob } = require('../../models');
const { writeAudit } = require('../auditService');

class TransitionError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}

const ALLOWED = {
  planned: ['producing', 'archived'],
  producing: ['awaiting_link', 'needs_review', 'planned', 'failed', 'archived'],
  needs_review: ['planned', 'archived'],
  awaiting_link: ['published', 'archived'],
  published: ['archived'],
  failed: ['planned', 'archived'],
  archived: [],
};

async function lockProject(id, t) {
  const p = await VideoProject.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
  if (!p) throw new TransitionError('not_found', 404);
  return p;
}

// 계획표 맨 위 자리(지금 planned 중 가장 작은 순서보다 하나 작게)
async function topOrder(t) {
  const min = await VideoProject.min('plan_order', { where: { status: 'planned' }, transaction: t });
  return (Number.isFinite(min) ? min : 0) - 1;
}

/** 상태 하나 옮기기 — 허용 안 된 전이는 409. patch 는 같이 바꿀 칸. */
async function move(project, to, { userId = null, reason = null, patch = {} } = {}, t) {
  const from = project.status;
  if (!(ALLOWED[from] || []).includes(to)) throw new TransitionError(`bad_transition_${from}_${to}`);
  await project.update({ ...patch, status: to }, { transaction: t });
  await writeAudit({
    userId, businessId: null, action: `video.${to}`, targetType: 'video_project', targetId: project.id,
    oldValue: { status: from }, newValue: { status: to, reason, by: userId ? 'admin' : 'video-worker' },
  }, { transaction: t });
  return project;
}

/** 요청 1건을 produce 작업과 함께 producing 으로 — claim 이 부른다(같은 트랜잭션). */
async function startProducing(project, t) {
  const job = await VideoJob.create({
    kind: 'produce', project_id: project.id, version_id: project.approved_version_id || null, status: 'queued',
    payload: { approved_version_id: project.approved_version_id || null, gate_overrides: project.gate_overrides || [], stage_from: project.stage_from || 'script' },
  }, { transaction: t });
  await move(project, 'producing', { reason: 'schedule', patch: { producing_started_at: new Date(), review_reason: null, review_detail: null } }, t);
  return job;
}

/** 작업 실패 — 3번 전이면 맨 위로 되돌리고, 3번째면 failed. review 가 있으면 needs_review(사람 몫이라 횟수 안 셈). */
async function onJobFailed(project, { code, message, review }, t) {
  if (review) {
    return move(project, 'needs_review', { reason: review.reason, patch: { review_reason: String(review.reason).slice(0, 40), review_detail: review.detail ? JSON.stringify(review.detail).slice(0, 60000) : null } }, t);
  }
  const attempts = project.attempts + 1;
  if (attempts >= 3) return move(project, 'failed', { reason: code, patch: { attempts, review_reason: String(code || 'failed').slice(0, 40), review_detail: String(message || '').slice(0, 2000) } }, t);
  return move(project, 'planned', { reason: code, patch: { attempts, plan_order: await topOrder(t), review_reason: String(code || 'failed').slice(0, 40), review_detail: String(message || '').slice(0, 2000) } }, t);
}

/**
 * 사람이 «확인 필요»·«실패» 를 다시 넣는다 (Fable 차단 5 — 다음 produce 가 같은 자리에서 다시 걸리지 않게).
 *   approvedVersionId 가 있으면 AI 대본을 건너뛰고 그 판으로 렌더 · gateOverrides 는 «그대로 쓰기» 한 장면.
 */
async function requeue(project, { userId, approvedVersionId = null, gateOverrides = null }, t) {
  const patch = { plan_order: await topOrder(t), attempts: 0 };
  if (approvedVersionId) Object.assign(patch, { approved_version_id: approvedVersionId, stage_from: 'render' });
  if (gateOverrides) patch.gate_overrides = gateOverrides;
  await writeAudit({ userId, businessId: null, action: 'video.requeue', targetType: 'video_project', targetId: project.id, newValue: { approved_version_id: approvedVersionId, gate_overrides: gateOverrides } }, { transaction: t });
  return move(project, 'planned', { userId, reason: 'requeue', patch }, t);
}

module.exports = { TransitionError, ALLOWED, lockProject, topOrder, move, startProducing, onJobFailed, requeue };
