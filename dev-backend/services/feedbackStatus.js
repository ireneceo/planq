// 사용자 피드백 상태 전이 — 한 곳 (2026-10-22, 설계 docs/FEEDBACK_APPROVAL_DESIGN.md · Fable 판정 PASS 조건부).
//
//   Irene: «고객이나 멤버 요청이 무조건 반영되지 않고 플랫폼관리자로 지정된 멤버의 최종 승인에 따라 진행하게 해야 해.
//           검토중을 무조건 거쳐야 해. 플랫폼관리자 피드백이 아니면. … 진행대기 단계가 있어야 할 것 같아.»
//
//   접수(pending) → 검토중(reviewing) → 진행대기(queued, 승인) → 반영중(in_progress) → 완료(done) / 보류(wontfix)
//
//   ★ «승인됨» 의 정본은 상태값이 아니라 `approved_at IS NOT NULL` 이다 — 개발시작 1-B 조회·회신 스크립트·배포 닫기가
//     같은 술어를 본다. 그래서 승인을 거두는 전이(진행대기→검토중, 완료·보류→검토중 다시 열기)는 approved_* 를 비운다.
//   ★ 쓰는 문: services/feedbackRespond(관리자 화면 PATCH · scripts/feedback-reply.js) · 배포 닫기(close-deployed-feedback).
//     상태를 직접 update 하지 않는다.

// DB ENUM 순서 그대로(끝에 append — scripts/migrate-feedback-approval.js). 화면 탭 순서는 FLOW.
const FEEDBACK_STATUSES = ['pending', 'reviewing', 'done', 'wontfix', 'queued', 'in_progress'];
const FLOW = ['pending', 'reviewing', 'queued', 'in_progress', 'done', 'wontfix'];

const TRANSITIONS = {
  pending: ['reviewing', 'done', 'wontfix'],          // 답만 하고 닫기(문의 답변)는 바로 된다 — 막는 것은 개발 착수뿐
  reviewing: ['queued', 'done', 'wontfix'],
  queued: ['in_progress', 'reviewing', 'wontfix'],    // →reviewing = 승인 취소
  in_progress: ['done', 'queued', 'wontfix'],
  done: ['reviewing'],                                // 다시 열기 — 승인부터 다시
  wontfix: ['reviewing'],
};
const WORK_STATES = ['queued', 'in_progress'];
const isApproved = (item) => !!(item && item.approved_at);

function fail(code, status = 409) {
  const e = new Error(code); e.code = code; e.status = status; return e;
}

/** 지금 상태에서 갈 수 있는 상태(같은 상태 = 답글만 고치기, 항상 된다). 추가 문의는 개발 단계로 못 간다. */
function nextStatusesOf(item) {
  const from = item.status;
  const list = TRANSITIONS[from] || [];
  return list.filter((s) => !(item.parent_id && WORK_STATES.includes(s)));
}

/**
 * 전이 판정 — 바꿀 칸(updates)을 돌려주거나 던진다(err.code · err.status).
 *   actor: { id, isPlatformAdmin }
 */
function planTransition(item, next, actor = {}) {
  if (!next || next === item.status) return {};
  if (!FEEDBACK_STATUSES.includes(next)) throw fail('invalid_status', 400);
  if (item.parent_id && WORK_STATES.includes(next)) throw fail('followup_follows_parent');
  if (item.status === 'pending' && next === 'queued') throw fail('review_required');
  if (!(TRANSITIONS[item.status] || []).includes(next)) throw fail('invalid_transition');
  if (next === 'in_progress' && !isApproved(item)) throw fail('approval_required');

  const updates = { status: next };
  if (next === 'queued' && item.status === 'reviewing') {
    if (!actor.isPlatformAdmin) throw fail('approver_required', 403);
    updates.approved_by = actor.id || null;
    updates.approved_at = new Date();
  }
  if (next === 'reviewing' && ['queued', 'done', 'wontfix'].includes(item.status)) {
    updates.approved_by = null;
    updates.approved_at = null;
  }
  return updates;
}

/** 새 피드백의 처음 상태 — 플랫폼관리자가 쓴 최상위 건은 바로 진행대기(본인 승인). 추가 문의는 언제나 접수. */
function initialFields({ isPlatformAdmin, userId, isFollowup }) {
  if (isPlatformAdmin && !isFollowup) return { status: 'queued', approved_by: userId, approved_at: new Date() };
  return { status: 'pending' };
}

// ── 배포 닫기 ──
// 승인 체계가 생긴 시각 — 마이그레이션이 approved_at 칸 설명(COMMENT)에 «approval_since=<ISO>» 로 남긴다.
//   그 전에 /개발완료 가 «고쳤지만 배포 전» 으로 단 reviewing 은 옛 규칙대로 닫는다(시한부 호환 — 옛 reviewing 이 0 이 되면 지운다).
let sinceCache;
async function approvalSince(sequelize) {
  if (sinceCache !== undefined) return sinceCache;
  const [rows] = await sequelize.query(`SELECT COLUMN_COMMENT c FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feedback_items' AND COLUMN_NAME = 'approved_at'`);
  const m = rows[0] && /approval_since=([0-9T:.\-Z]+)/.exec(rows[0].c || '');
  sinceCache = m ? new Date(m[1]) : null;
  return sinceCache;
}

/** 배포에 실린 건을 닫아도 되나 — { close, legacy, reason } */
function deployCloseDecision(item, since) {
  if (item.status === 'done') return { close: false, reason: '이미 done' };
  if (item.parent_id) return { close: false, reason: '추가 문의 — 부모 스레드로 닫는다' };
  const answered = !!(item.admin_response && String(item.admin_response).trim());
  if (!answered) return { close: false, reason: '답글 없음 — 먼저 답글을 다세요' };
  if (item.status === 'in_progress' && isApproved(item)) return { close: true, legacy: false };
  if (item.status === 'reviewing' && !isApproved(item) && since && item.responded_at && new Date(item.responded_at) < since) {
    return { close: true, legacy: true };
  }
  return { close: false, reason: `승인 전(${item.status}) — 관리자 승인·반영중을 거치지 않았다` };
}

module.exports = {
  FEEDBACK_STATUSES, FLOW, TRANSITIONS, WORK_STATES,
  isApproved, nextStatusesOf, planTransition, initialFields, approvalSince, deployCloseDecision,
};
