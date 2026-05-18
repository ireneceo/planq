// /api/focus — 업무 흐름 (Focus) 세션 라우트
// 사이클 N+26 신규.
//
// 정책 요약:
//   - 본인 데이터만. owner/admin 도 못 봄 (개인 시간).
//   - 한 user 의 active+paused row 동시 최대 1개 (start 시 기존 stop)
//   - focus_enabled=false 일 때 라우트는 403 (개인 설정에서 활성화 후 사용)
//   - heartbeat rate-limit (분당 60), start/stop (분당 10)

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { Op } = require('sequelize');

const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../utils/response');
const {
  FocusSession, User, Task, TaskReviewer, AuditLog,
} = require('../models');
const { sequelize } = require('../config/database');
const { recomputeActualHoursFromHistory } = require('../services/taskActualHours');

// ─── 헬퍼 ────────────────────────────────────────────────────────
const startStopLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  keyGenerator: (req) => req.user?.id ? `focus-ss-u${req.user.id}` : `focus-ss-ip${ipKeyGenerator(req)}`,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: '포커스 시작·종료를 너무 자주 호출했습니다. 잠시 후 다시 시도하세요.' },
});
const heartbeatLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120,  // 30s 간격 + 여유
  keyGenerator: (req) => req.user?.id ? `focus-hb-u${req.user.id}` : `focus-hb-ip${ipKeyGenerator(req)}`,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'heartbeat rate exceeded' },
});

/** focus_enabled=true 확인. false 면 403. */
async function requireFocusEnabled(req, res) {
  const user = await User.findByPk(req.user.id, { attributes: ['id', 'focus_enabled'] });
  if (!user) { errorResponse(res, 'user_not_found', 404); return null; }
  if (!user.focus_enabled) { errorResponse(res, 'focus_disabled', 403, { hint: 'Enable in /profile work-flow settings' }); return null; }
  return user;
}

/** session 응답 직렬화 — 계산된 actual_seconds 포함 */
function serializeSession(session, taskInfo = null) {
  if (!session) return null;
  return {
    id: session.id,
    user_id: session.user_id,
    business_id: session.business_id,
    task_id: session.task_id,
    state: session.state,
    started_at: session.started_at,
    ended_at: session.ended_at,
    paused_at: session.paused_at,
    pause_total_sec: session.pause_total_sec,
    actual_seconds: session.computeActualSeconds(),
    auto_paused: session.auto_paused,
    end_reason: session.end_reason,
    task: taskInfo,
  };
}

/** task 정보 (응답에 포함) */
async function loadTaskInfo(taskId) {
  if (!taskId) return null;
  const t = await Task.findByPk(taskId, { attributes: ['id', 'title', 'status', 'project_id', 'business_id'] });
  return t ? { id: t.id, title: t.title, status: t.status, project_id: t.project_id } : null;
}

// ─── GET /current ────────────────────────────────────────────────
router.get('/current', authenticateToken, async (req, res, next) => {
  try {
    const session = await FocusSession.findOne({
      where: { user_id: req.user.id, state: { [Op.in]: ['active', 'paused'] } },
      order: [['id', 'DESC']],
    });
    if (!session) return successResponse(res, null);
    const taskInfo = await loadTaskInfo(session.task_id);
    return successResponse(res, serializeSession(session, taskInfo));
  } catch (err) { next(err); }
});

// ─── POST /start ─────────────────────────────────────────────────
// body: { business_id, task_id?: number }
// 동작: 기존 active/paused 있으면 stop (end_reason='switch') → 새 session insert
router.post('/start', authenticateToken, startStopLimiter, async (req, res, next) => {
  try {
    const user = await requireFocusEnabled(req, res);
    if (!user) return;
    const { business_id, task_id } = req.body;
    if (!business_id) return errorResponse(res, 'business_id_required', 400);

    const t = await sequelize.transaction();
    try {
      // 1) 기존 active/paused stop
      const existing = await FocusSession.findOne({
        where: { user_id: req.user.id, state: { [Op.in]: ['active', 'paused'] } },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      if (existing) {
        // pause_total_sec 정리 (paused 였으면 진입 후 경과 더함)
        let extraPause = 0;
        if (existing.state === 'paused' && existing.paused_at) {
          extraPause = Math.max(0, Math.floor((Date.now() - new Date(existing.paused_at).getTime()) / 1000));
        }
        await existing.update({
          state: 'stopped',
          ended_at: new Date(),
          pause_total_sec: existing.pause_total_sec + extraPause,
          paused_at: null,
          end_reason: 'switch',
        }, { transaction: t });
        // 이전 task 의 actual_hours 재계산 (status_history 기반)
        if (existing.task_id) {
          await recomputeActualHoursFromHistory(existing.task_id).catch(() => null);
        }
      }
      // 2) 신규 session
      const session = await FocusSession.create({
        user_id: req.user.id,
        business_id: Number(business_id),
        task_id: task_id ? Number(task_id) : null,
        state: 'active',
        started_at: new Date(),
        last_activity_at: new Date(),
      }, { transaction: t });
      await t.commit();

      await AuditLog.create({
        user_id: req.user.id,
        business_id: Number(business_id),
        action: 'focus.start',
        entity_type: 'focus_session',
        entity_id: session.id,
        new_value: { task_id: session.task_id, switched_from: existing?.id || null },
      }).catch(() => null);

      const taskInfo = await loadTaskInfo(session.task_id);
      return successResponse(res, serializeSession(session, taskInfo));
    } catch (e) { await t.rollback(); throw e; }
  } catch (err) { next(err); }
});

// ─── POST /pause ─────────────────────────────────────────────────
// body: { session_id, reason?: 'manual' | 'auto_idle' }
router.post('/pause', authenticateToken, startStopLimiter, async (req, res, next) => {
  try {
    const { session_id, reason } = req.body;
    const session = await FocusSession.findOne({ where: { id: session_id, user_id: req.user.id } });
    if (!session) return errorResponse(res, 'session_not_found', 404);
    if (session.state !== 'active') return errorResponse(res, 'not_active', 400);
    await session.update({
      state: 'paused',
      paused_at: new Date(),
      auto_paused: reason === 'auto_idle',
    });
    await AuditLog.create({
      user_id: req.user.id, business_id: session.business_id,
      action: reason === 'auto_idle' ? 'focus.auto_pause' : 'focus.pause',
      entity_type: 'focus_session', entity_id: session.id,
    }).catch(() => null);
    const taskInfo = await loadTaskInfo(session.task_id);
    return successResponse(res, serializeSession(session, taskInfo));
  } catch (err) { next(err); }
});

// ─── POST /resume ────────────────────────────────────────────────
router.post('/resume', authenticateToken, startStopLimiter, async (req, res, next) => {
  try {
    const { session_id } = req.body;
    const session = await FocusSession.findOne({ where: { id: session_id, user_id: req.user.id } });
    if (!session) return errorResponse(res, 'session_not_found', 404);
    if (session.state !== 'paused') return errorResponse(res, 'not_paused', 400);
    const pausedFor = session.paused_at
      ? Math.max(0, Math.floor((Date.now() - new Date(session.paused_at).getTime()) / 1000))
      : 0;
    await session.update({
      state: 'active',
      paused_at: null,
      pause_total_sec: session.pause_total_sec + pausedFor,
      auto_paused: false,
      last_activity_at: new Date(),
    });
    await AuditLog.create({
      user_id: req.user.id, business_id: session.business_id,
      action: 'focus.resume',
      entity_type: 'focus_session', entity_id: session.id,
      new_value: { paused_for_sec: pausedFor },
    }).catch(() => null);
    const taskInfo = await loadTaskInfo(session.task_id);
    return successResponse(res, serializeSession(session, taskInfo));
  } catch (err) { next(err); }
});

// ─── POST /stop ──────────────────────────────────────────────────
// body: { session_id, end_reason?: 'manual' | 'logout' | 'browser_close' }
router.post('/stop', authenticateToken, startStopLimiter, async (req, res, next) => {
  try {
    const { session_id, end_reason } = req.body;
    const session = await FocusSession.findOne({ where: { id: session_id, user_id: req.user.id } });
    if (!session) return errorResponse(res, 'session_not_found', 404);
    if (session.state === 'stopped') return successResponse(res, serializeSession(session, await loadTaskInfo(session.task_id)));
    let extraPause = 0;
    if (session.state === 'paused' && session.paused_at) {
      extraPause = Math.max(0, Math.floor((Date.now() - new Date(session.paused_at).getTime()) / 1000));
    }
    await session.update({
      state: 'stopped',
      ended_at: new Date(),
      pause_total_sec: session.pause_total_sec + extraPause,
      paused_at: null,
      end_reason: end_reason || 'manual',
    });
    if (session.task_id) {
      await recomputeActualHoursFromHistory(session.task_id).catch(() => null);
    }
    await AuditLog.create({
      user_id: req.user.id, business_id: session.business_id,
      action: 'focus.stop',
      entity_type: 'focus_session', entity_id: session.id,
      new_value: { actual_seconds: session.computeActualSeconds(), end_reason: session.end_reason },
    }).catch(() => null);
    const taskInfo = await loadTaskInfo(session.task_id);
    return successResponse(res, serializeSession(session, taskInfo));
  } catch (err) { next(err); }
});

// ─── POST /heartbeat ─────────────────────────────────────────────
// 활동 기록만 — 응답 body 없음 (가벼움). 30s 간격 권장.
router.post('/heartbeat', authenticateToken, heartbeatLimiter, async (req, res, next) => {
  try {
    const { session_id } = req.body;
    const session = await FocusSession.findOne({ where: { id: session_id, user_id: req.user.id, state: 'active' } });
    if (!session) return successResponse(res, null);  // 활성 아니면 silent (race)
    await session.update({ last_activity_at: new Date() });
    return successResponse(res, { last_activity_at: session.last_activity_at });
  } catch (err) { next(err); }
});

// ─── POST /idle-discard ──────────────────────────────────────────
// 유휴 감지된 N초 를 pause_total_sec 에 더해 빼버리기
// body: { session_id, idle_seconds }
router.post('/idle-discard', authenticateToken, async (req, res, next) => {
  try {
    const { session_id, idle_seconds } = req.body;
    const sec = Number(idle_seconds);
    if (!Number.isFinite(sec) || sec <= 0 || sec > 24 * 3600) return errorResponse(res, 'invalid_seconds', 400);
    const session = await FocusSession.findOne({ where: { id: session_id, user_id: req.user.id } });
    if (!session) return errorResponse(res, 'session_not_found', 404);
    if (session.state === 'stopped') return errorResponse(res, 'already_stopped', 400);
    await session.update({ pause_total_sec: session.pause_total_sec + Math.floor(sec) });
    await AuditLog.create({
      user_id: req.user.id, business_id: session.business_id,
      action: 'focus.idle_discard',
      entity_type: 'focus_session', entity_id: session.id,
      new_value: { discarded_seconds: Math.floor(sec) },
    }).catch(() => null);
    const taskInfo = await loadTaskInfo(session.task_id);
    return successResponse(res, serializeSession(session, taskInfo));
  } catch (err) { next(err); }
});

// ─── GET /daily-prompt-items ─────────────────────────────────────
// 오늘 시작 모달용 — 오늘마감 + 확인요청 + 지연된 업무 (담당자=me)
// 사용자가 진입 시 한 번 호출하여 모달 본문 채움.
router.get('/daily-prompt-items', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const yesterday = new Date(); yesterday.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

    // 1) 오늘 마감 (담당자=me, due_date <= 오늘, 미완료)
    const todayDue = await Task.findAll({
      where: {
        assignee_id: userId,
        status: { [Op.in]: ['not_started', 'waiting', 'in_progress', 'revision_requested'] },
        due_date: { [Op.lte]: today, [Op.gte]: yesterday },
      },
      attributes: ['id', 'title', 'status', 'due_date', 'progress_percent', 'business_id', 'project_id'],
      order: [['due_date', 'ASC']], limit: 3,
    });

    // 2) 확인 요청 받음 (reviewer=me, state=pending, task.status in reviewing/revision_requested)
    const reviewerRows = await TaskReviewer.findAll({
      where: { user_id: userId, state: 'pending' },
      include: [{
        model: Task,
        where: { status: { [Op.in]: ['reviewing', 'revision_requested'] } },
        attributes: ['id', 'title', 'status', 'due_date', 'progress_percent', 'business_id', 'project_id'],
        required: true,
      }],
      limit: 2,
    });

    // 3) 지연된 업무 (담당자=me, due_date < 오늘 시작, 미완료)
    const overdue = await Task.findAll({
      where: {
        assignee_id: userId,
        status: { [Op.in]: ['not_started', 'waiting', 'in_progress', 'revision_requested'] },
        due_date: { [Op.lt]: yesterday },
      },
      attributes: ['id', 'title', 'status', 'due_date', 'progress_percent', 'business_id', 'project_id'],
      order: [['due_date', 'ASC']], limit: 2,
    });

    const seen = new Set();
    const pack = (arr, kind) => arr.filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id); return true;
    }).map(t => ({
      id: t.id, title: t.title, status: t.status, due_date: t.due_date,
      progress_percent: t.progress_percent, business_id: t.business_id,
      project_id: t.project_id, kind,
    }));

    return successResponse(res, {
      today: pack(todayDue, 'today'),
      review: pack(reviewerRows.map(r => r.Task), 'review'),
      overdue: pack(overdue, 'overdue'),
    });
  } catch (err) { next(err); }
});

// ─── GET /today-summary ──────────────────────────────────────────
// 오늘 누적 focus 시간 + session 수 (대시보드/위젯용)
router.get('/today-summary', authenticateToken, async (req, res, next) => {
  try {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const sessions = await FocusSession.findAll({
      where: { user_id: req.user.id, started_at: { [Op.gte]: dayStart } },
      attributes: ['id', 'state', 'started_at', 'ended_at', 'pause_total_sec', 'paused_at'],
    });
    let totalSec = 0;
    for (const s of sessions) totalSec += s.computeActualSeconds();
    return successResponse(res, {
      total_seconds: totalSec,
      session_count: sessions.length,
      active_now: sessions.some(s => s.state === 'active'),
    });
  } catch (err) { next(err); }
});

// ─── GET /settings / PUT /settings ───────────────────────────────
// 개인 설정 — 5컬럼
router.get('/settings', authenticateToken, async (req, res, next) => {
  try {
    const u = await User.findByPk(req.user.id, {
      attributes: ['id', 'focus_enabled', 'focus_idle_min', 'focus_auto_pause_min', 'focus_daily_prompt', 'focus_prompt_last_dismissed_date'],
    });
    if (!u) return errorResponse(res, 'user_not_found', 404);
    return successResponse(res, u);
  } catch (err) { next(err); }
});

router.put('/settings', authenticateToken, async (req, res, next) => {
  try {
    const u = await User.findByPk(req.user.id);
    if (!u) return errorResponse(res, 'user_not_found', 404);
    const patch = {};
    if (typeof req.body.focus_enabled === 'boolean') patch.focus_enabled = req.body.focus_enabled;
    if (Number.isFinite(req.body.focus_idle_min) && req.body.focus_idle_min >= 5 && req.body.focus_idle_min <= 120) {
      patch.focus_idle_min = Math.floor(req.body.focus_idle_min);
    }
    if (Number.isFinite(req.body.focus_auto_pause_min) && req.body.focus_auto_pause_min >= 10 && req.body.focus_auto_pause_min <= 240) {
      patch.focus_auto_pause_min = Math.floor(req.body.focus_auto_pause_min);
    }
    if (typeof req.body.focus_daily_prompt === 'boolean') patch.focus_daily_prompt = req.body.focus_daily_prompt;
    if (req.body.focus_prompt_last_dismissed_date === null) patch.focus_prompt_last_dismissed_date = null;
    if (typeof req.body.focus_prompt_last_dismissed_date === 'string') patch.focus_prompt_last_dismissed_date = req.body.focus_prompt_last_dismissed_date;
    await u.update(patch);
    return successResponse(res, {
      focus_enabled: u.focus_enabled,
      focus_idle_min: u.focus_idle_min,
      focus_auto_pause_min: u.focus_auto_pause_min,
      focus_daily_prompt: u.focus_daily_prompt,
      focus_prompt_last_dismissed_date: u.focus_prompt_last_dismissed_date,
    });
  } catch (err) { next(err); }
});

module.exports = router;
