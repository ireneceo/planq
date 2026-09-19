// Q Note ↔ Q Task 브릿지 (사이클 N+88)
//
// Q Note 는 별도 FastAPI + SQLite(qnote.db). tasks/task_candidates 는 MySQL(Node).
// cross-DB 단방향 브릿지 — 프론트(QNotePage/MemoView)가 요약/transcript 텍스트를 넘기면
// 기존 task_extractor 파이프라인을 재사용해 업무 후보를 추출/등록한다.
//
// 라우트 (mount: /api/businesses):
//   POST  /:bizId/qnote-sessions/:sid/extract-tasks                  text+title 로 후보 추출
//   GET   /:bizId/qnote-sessions/:sid/task-candidates                이 세션 pending 후보
//   POST  /:bizId/qnote-sessions/:sid/task-candidates/:cid/register  후보 → 정식 업무
//   POST  /:bizId/qnote-sessions/:sid/task-candidates/:cid/reject    후보 무시
//
// 권한: qtask write (후보/업무 생성). 멀티테넌트 — task_candidates.business_id 직접 격리.
// Q Note 사적 원칙은 프론트가 본인 세션 text 만 넘기는 것으로 보장 (브릿지는 qnote.db 미접근).

const express = require('express');
const router = express.Router();
const { TaskCandidate, User } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { requireMenu } = require('../middleware/menu_permission');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { applyMemberDisplayName } = require('../services/displayName');

// 실시간 broadcast (CLAUDE.md §16 — 모든 mutation 라우트 필수)
function broadcast(req, businessId, event, payload) {
  const io = req.app.get('io');
  if (!io) return;
  io.to(`business:${businessId}`).emit(event, payload);
}

// POST extract-tasks — Q Note 세션 text 에서 업무 후보 추출
router.post('/:businessId/qnote-sessions/:sid/extract-tasks',
  authenticateToken, checkBusinessAccess, requireMenu('qtask', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const sid = Number(req.params.sid);
      const { text, title } = req.body || {};
      if (!text || !String(text).trim()) return errorResponse(res, 'text_required', 400);
      // ★ 세션이 붙어 있는 프로젝트를 **가져다 쓴다**(있으면). q-note 는 별도 서비스라 Node 가
      //   직접 못 읽으므로 내부 문으로 묻는다. **실패해도 추출은 막지 않는다** — 프로젝트 귀속은
      //   편의이고, 못 알아냈다고 업무 추출 자체를 못 하게 하면 손해가 더 크다.
      //   (그래서 여기서는 소유 확인을 «차단» 이 아니라 «알아내기» 로만 쓴다 — 팀원이 공유받은
      //    노트에서 뽑는 정상 경로를 막지 않기 위해서다.)
      let projectId = null;
      try {
        const { verifyQnoteSession } = require('../services/qnoteOwnership');
        const v = await verifyQnoteSession({ sessionId: sid, userId: req.user.id, businessId });
        if (v.ok && v.session && v.session.project_id) projectId = Number(v.session.project_id);
      } catch { /* 못 알아내면 워크스페이스 업무로 — 종전 동작 */ }

      const extractor = require('../services/task_extractor');
      const out = await extractor.extractNoteTaskCandidates({
        text: String(text), title: title ? String(title) : '', qnoteSessionId: sid, userId: req.user.id, businessId, projectId,
      });
      if (out.skipped === 'usage_limit_exceeded') return errorResponse(res, 'cue_usage_limit_exceeded', 429);
      if ((out.candidates || []).length) {
        broadcast(req, businessId, 'candidate:new', { qnote_session_id: sid, count: out.candidates.length });
      }
      return successResponse(res, { candidates: out.candidates || [], reason: out.reason || null });
    } catch (err) { next(err); }
  }
);

// GET task-candidates — 이 세션의 pending 후보
router.get('/:businessId/qnote-sessions/:sid/task-candidates',
  authenticateToken, checkBusinessAccess, requireMenu('qtask', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const sid = Number(req.params.sid);
      const rows = await TaskCandidate.findAll({
        where: { qnote_session_id: sid, business_id: businessId, status: 'pending' },
        include: [{ model: User, as: 'guessedAssignee', attributes: ['id', 'name'], required: false }],
        order: [['id', 'DESC']],
      });
      const items = rows.map((r) => r.toJSON());
      await applyMemberDisplayName(items, businessId, ['guessedAssignee']);
      return successResponse(res, items);
    } catch (err) { next(err); }
  }
);

// POST register — 후보 → 정식 업무 (overrides: title/assignee_id/start_date/due_date/description)
router.post('/:businessId/qnote-sessions/:sid/task-candidates/:cid/register',
  authenticateToken, checkBusinessAccess, requireMenu('qtask', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const sid = Number(req.params.sid);
      // tenant 격리 — 후보가 이 워크스페이스 + 이 세션 소속인지 확인 (cross-tenant IDOR 차단)
      const cand = await TaskCandidate.findOne({ where: { id: Number(req.params.cid), qnote_session_id: sid, business_id: businessId } });
      if (!cand) return errorResponse(res, 'candidate_not_found', 404);
      const extractor = require('../services/task_extractor');
      // broadcast·알림·감사는 행동 계층(createTask)이 소유한다 — 여기서 또 쏘면 중복이다.
      const out = await extractor.registerCandidate(cand.id, req.user.id, req.body || {});
      return successResponse(res, out, 'registered', 201);
    } catch (err) {
      // 행동 계층의 거부는 그 상태 그대로 (cannot_assign·menu_forbidden 403 …) — 사람이 쓰는 POST /api/tasks 와 같은 코드
      if (err.http) return errorResponse(res, err.message, err.http);
      if (/candidate_(not_found|already_resolved|business_unresolved)/.test(err.message)) return errorResponse(res, err.message, 400);
      next(err);
    }
  }
);

// POST reject — 후보 무시
router.post('/:businessId/qnote-sessions/:sid/task-candidates/:cid/reject',
  authenticateToken, checkBusinessAccess, requireMenu('qtask', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const sid = Number(req.params.sid);
      const cand = await TaskCandidate.findOne({ where: { id: Number(req.params.cid), qnote_session_id: sid, business_id: businessId } });
      if (!cand) return errorResponse(res, 'candidate_not_found', 404);
      const extractor = require('../services/task_extractor');
      await extractor.rejectCandidate(cand.id, req.user.id);
      return successResponse(res, { id: cand.id, status: 'rejected' });
    } catch (err) { next(err); }
  }
);

module.exports = router;
