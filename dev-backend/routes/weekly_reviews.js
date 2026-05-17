// routes/weekly_reviews.js — 주간 보고 API
//
// POST   /                — 수동 박제
// GET    /                — 누적 결산 목록
// GET    /latest          — 가장 최근 결산 (월요일 배너용)
// GET    /:id             — 풀 view
// PATCH  /:id             — retro_note 수정
// DELETE /:id             — 결산 삭제
// GET    /settings        — 자동 박제 설정 조회
// PUT    /settings        — 자동 박제 ON/OFF

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { authenticateToken } = require('../middleware/auth');
const { WeeklyReview, WeeklyReviewSetting, Business, BusinessMember, BusinessWeeklyReport, User } = require('../models');
const { buildSnapshot, buildWorkspaceSnapshot } = require('../services/weeklyReviewSnapshot');
const { successResponse, errorResponse } = require('../utils/response');
const { logAudit } = require('../services/auditService');

// 날짜 유틸
function mondayOfDateStr(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function addDaysStr(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// 워크스페이스 timezone 기준 오늘
function todayInTz(tz) {
  try {
    return new Date().toLocaleDateString('sv-SE', { timeZone: tz });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// ============================================
// POST / — 수동 박제
// body: { business_id, week_start?, retro_note? }
// query: ?overwrite=true — 기존 row 덮어쓰기
// ============================================
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, week_start, retro_note } = req.body;
    const userId = req.user.id;

    if (!business_id) return errorResponse(res, 'business_id required', 400);

    // 워크스페이스 접근 권한 확인
    const member = await BusinessMember.findOne({
      where: { user_id: userId, business_id },
    });
    if (!member) return errorResponse(res, 'forbidden', 403);

    // 워크스페이스 timezone
    const biz = await Business.findByPk(business_id, { attributes: ['timezone'] });
    const wsTz = biz?.timezone || 'Asia/Seoul';

    // week_start — 미지정 시 현재 주
    const today = todayInTz(wsTz);
    const monday = week_start || mondayOfDateStr(today);
    const sunday = addDaysStr(monday, 6);

    // 미래 주차 방지
    if (monday > today) {
      return errorResponse(res, 'invalid_week', 400, { message: 'Cannot finalize future week' });
    }

    // 기존 row 확인
    const existing = await WeeklyReview.findOne({
      where: { user_id: userId, business_id, week_start: monday },
    });

    if (existing && req.query.overwrite !== 'true') {
      return errorResponse(res, 'already_exists', 409, {
        message: 'Weekly review already exists for this week',
        existing_id: existing.id,
      });
    }

    // 스냅샷 빌드
    const snapshot = await buildSnapshot(userId, business_id, monday, sunday);

    // 빈 주 허용 (수동이므로)
    // if (snapshot.summary.total === 0) {
    //   return errorResponse(res, 'empty_week', 400, { message: 'No tasks in this week' });
    // }

    if (existing) {
      // 덮어쓰기
      await existing.update({
        week_end: sunday,
        finalized_at: new Date(),
        finalized_by: 'manual',
        snapshot_data: snapshot,
        retro_note: retro_note !== undefined ? retro_note : existing.retro_note,
      });
      return successResponse(res, existing.toJSON(), 'Weekly review updated');
    } else {
      // 신규 생성
      const review = await WeeklyReview.create({
        user_id: userId,
        business_id,
        week_start: monday,
        week_end: sunday,
        finalized_at: new Date(),
        finalized_by: 'manual',
        snapshot_data: snapshot,
        retro_note: retro_note || null,
      });
      return successResponse(res, review.toJSON(), 'Weekly review created', 201);
    }
  } catch (err) {
    next(err);
  }
});

// ============================================
// GET / — 누적 결산 목록
// query: ?business_id=&user_id=&limit=12&before=
// ============================================
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, user_id, limit = 12, before } = req.query;
    const myId = req.user.id;

    if (!business_id) return errorResponse(res, 'business_id required', 400);

    // 워크스페이스 접근 권한
    const member = await BusinessMember.findOne({
      where: { user_id: myId, business_id },
    });
    if (!member) return errorResponse(res, 'forbidden', 403);

    // user_id='all' (워크스페이스 전체) — owner 만. 그 외는 본인 또는 user_id 지정.
    let where;
    if (user_id === 'all') {
      if (member.role !== 'owner') {
        return errorResponse(res, 'forbidden', 403, { message: 'Only owner can view all member reviews' });
      }
      where = { business_id };
    } else {
      const targetUserId = user_id ? Number(user_id) : myId;
      if (targetUserId !== myId && member.role !== 'owner') {
        return errorResponse(res, 'forbidden', 403, { message: 'Only owner can view other member reviews' });
      }
      where = { user_id: targetUserId, business_id };
    }
    if (before) {
      where.week_start = { [Op.lt]: before };
    }

    const reviews = await WeeklyReview.findAll({
      where,
      order: [['week_start', 'DESC'], ['user_id', 'ASC']],
      limit: Math.min(100, Number(limit) || 12),
      attributes: ['id', 'user_id', 'week_start', 'week_end', 'finalized_at', 'finalized_by', 'retro_note', 'snapshot_data', 'created_at'],
    });

    // workspace 전체 모드 — user 이름 포함
    let userMap = {};
    if (user_id === 'all') {
      const userIds = [...new Set(reviews.map(r => r.user_id))];
      if (userIds.length > 0) {
        const { User } = require('../models');
        const users = await User.findAll({ where: { id: userIds }, attributes: ['id', 'name'] });
        userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
      }
    }

    // summary 만 포함 (tasks 제외)
    const list = reviews.map(r => {
      const snap = r.snapshot_data || {};
      return {
        id: r.id,
        user_id: r.user_id,
        user_name: userMap[r.user_id] || null,
        week_start: r.week_start,
        week_end: r.week_end,
        finalized_at: r.finalized_at,
        finalized_by: r.finalized_by,
        retro_note: r.retro_note,
        summary: snap.summary || null,
        created_at: r.created_at,
      };
    });

    return successResponse(res, list);
  } catch (err) {
    next(err);
  }
});

// ============================================
// GET /latest — 가장 최근 결산
// query: ?business_id=
// ============================================
router.get('/latest', authenticateToken, async (req, res, next) => {
  try {
    const { business_id } = req.query;
    const userId = req.user.id;

    if (!business_id) return errorResponse(res, 'business_id required', 400);

    const member = await BusinessMember.findOne({
      where: { user_id: userId, business_id },
    });
    if (!member) return errorResponse(res, 'forbidden', 403);

    const review = await WeeklyReview.findOne({
      where: { user_id: userId, business_id },
      order: [['week_start', 'DESC']],
    });

    if (!review) {
      return successResponse(res, null);
    }

    return successResponse(res, review.toJSON());
  } catch (err) {
    next(err);
  }
});

// ============================================
// GET /settings — 자동 박제 설정 조회
// query: ?business_id=
// ============================================
router.get('/settings', authenticateToken, async (req, res, next) => {
  try {
    const { business_id } = req.query;
    const userId = req.user.id;

    if (!business_id) return errorResponse(res, 'business_id required', 400);

    const member = await BusinessMember.findOne({
      where: { user_id: userId, business_id },
    });
    if (!member) return errorResponse(res, 'forbidden', 403);

    const setting = await WeeklyReviewSetting.findOne({
      where: { user_id: userId, business_id },
    });

    // row 없으면 default ON
    return successResponse(res, {
      auto_enabled: setting ? setting.auto_enabled : true,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// PUT /settings — 자동 박제 ON/OFF
// body: { business_id, auto_enabled }
// ============================================
router.put('/settings', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, auto_enabled } = req.body;
    const userId = req.user.id;

    if (!business_id) return errorResponse(res, 'business_id required', 400);
    if (auto_enabled === undefined) return errorResponse(res, 'auto_enabled required', 400);

    const member = await BusinessMember.findOne({
      where: { user_id: userId, business_id },
    });
    if (!member) return errorResponse(res, 'forbidden', 403);

    const [setting, created] = await WeeklyReviewSetting.findOrCreate({
      where: { user_id: userId, business_id },
      defaults: { auto_enabled: !!auto_enabled },
    });

    if (!created) {
      await setting.update({ auto_enabled: !!auto_enabled });
    }

    return successResponse(res, { auto_enabled: setting.auto_enabled });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// 워크스페이스 통합 주간 보고서 (사이클 N+18) — /workspace/...
// 워크스페이스 × 주차 = 1 row. owner/admin 만 박제·편집·삭제.
// literal 경로 → /:id 보다 먼저 정의 (express literal-first 룰).
// ─────────────────────────────────────────────────────────────

async function assertWorkspaceAdmin(userId, businessId) {
  const member = await BusinessMember.findOne({
    where: { user_id: userId, business_id: businessId },
    attributes: ['role'],
  });
  if (!member) return { ok: false, code: 'not_member' };
  if (!['owner', 'admin'].includes(member.role)) return { ok: false, code: 'forbidden' };
  return { ok: true, role: member.role };
}

// ----- POST /workspace — 수동 박제 (owner/admin)
router.post('/workspace', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, week_start } = req.body;
    const userId = req.user.id;
    if (!business_id) return errorResponse(res, 'business_id required', 400);

    const adm = await assertWorkspaceAdmin(userId, business_id);
    if (!adm.ok) return errorResponse(res, adm.code === 'not_member' ? 'forbidden' : 'workspace_admin_required', 403);

    const biz = await Business.findByPk(business_id, { attributes: ['timezone'] });
    const wsTz = biz?.timezone || 'Asia/Seoul';
    const today = todayInTz(wsTz);
    const monday = week_start || mondayOfDateStr(today);
    const sunday = addDaysStr(monday, 6);
    if (monday > today) return errorResponse(res, 'invalid_week', 400, { message: 'Cannot finalize future week' });

    const snapshot = await buildWorkspaceSnapshot(business_id, monday);

    // upsert — UNIQUE (business_id, week_start)
    const existing = await BusinessWeeklyReport.findOne({
      where: { business_id, week_start: monday },
    });
    let row;
    if (existing) {
      await existing.update({
        week_end: sunday,
        finalized_at: new Date(),
        finalized_by: 'manual',
        finalized_by_user_id: userId,
        snapshot_data: snapshot,
      });
      row = existing;
    } else {
      row = await BusinessWeeklyReport.create({
        business_id, week_start: monday, week_end: sunday,
        finalized_at: new Date(),
        finalized_by: 'manual',
        finalized_by_user_id: userId,
        snapshot_data: snapshot,
      });
    }
    logAudit(req, {
      action: existing ? 'workspace_weekly_report.overwrite' : 'workspace_weekly_report.create',
      targetType: 'business_weekly_report',
      targetId: row.id,
      newValue: { business_id, week_start: monday, finalized_by: 'manual' },
    });
    return successResponse(res, row.toJSON(), existing ? 'Workspace weekly report updated' : 'Workspace weekly report created', existing ? 200 : 201);
  } catch (err) { next(err); }
});

// ----- GET /workspace — 통합본 리스트
router.get('/workspace', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, limit = 24, before } = req.query;
    const userId = req.user.id;
    if (!business_id) return errorResponse(res, 'business_id required', 400);

    const member = await BusinessMember.findOne({ where: { user_id: userId, business_id } });
    if (!member) return errorResponse(res, 'forbidden', 403);

    const where = { business_id };
    if (before) where.week_start = { [Op.lt]: before };

    const rows = await BusinessWeeklyReport.findAll({
      where,
      order: [['week_start', 'DESC']],
      limit: Math.min(100, Number(limit) || 24),
      attributes: ['id', 'business_id', 'week_start', 'week_end', 'finalized_at', 'finalized_by', 'finalized_by_user_id', 'executive_summary', 'retro_note', 'snapshot_data', 'created_at'],
      include: [{ model: User, as: 'finalizer', attributes: ['id', 'name'], required: false }],
    });
    // 리스트는 가볍게 — kpi 만 포함, 큰 배열 제외
    const list = rows.map(r => {
      const snap = r.snapshot_data || {};
      return {
        id: r.id,
        week_start: r.week_start,
        week_end: r.week_end,
        finalized_at: r.finalized_at,
        finalized_by: r.finalized_by,
        finalizer_name: r.finalizer?.name || null,
        executive_summary: r.executive_summary,
        retro_note: r.retro_note,
        kpi: snap.kpi || null,
        created_at: r.created_at,
      };
    });
    return successResponse(res, list);
  } catch (err) { next(err); }
});

// ----- GET /workspace/:rid — 통합본 단건
router.get('/workspace/:rid', authenticateToken, async (req, res, next) => {
  try {
    const { rid } = req.params;
    const userId = req.user.id;
    const row = await BusinessWeeklyReport.findByPk(rid);
    if (!row) return errorResponse(res, 'not_found', 404);
    const member = await BusinessMember.findOne({ where: { user_id: userId, business_id: row.business_id } });
    if (!member) return errorResponse(res, 'forbidden', 403);
    return successResponse(res, row.toJSON());
  } catch (err) { next(err); }
});

// ----- PUT /workspace/:rid — executive_summary + retro_note (owner/admin)
router.put('/workspace/:rid', authenticateToken, async (req, res, next) => {
  try {
    const { rid } = req.params;
    const { executive_summary, retro_note } = req.body;
    const userId = req.user.id;
    const row = await BusinessWeeklyReport.findByPk(rid);
    if (!row) return errorResponse(res, 'not_found', 404);
    const adm = await assertWorkspaceAdmin(userId, row.business_id);
    if (!adm.ok) return errorResponse(res, 'workspace_admin_required', 403);

    const patch = {};
    if (executive_summary !== undefined) patch.executive_summary = executive_summary || null;
    if (retro_note !== undefined) patch.retro_note = retro_note || null;
    if (Object.keys(patch).length === 0) return errorResponse(res, 'nothing_to_update', 400);

    const oldValue = { executive_summary: row.executive_summary, retro_note: row.retro_note };
    await row.update(patch);
    logAudit(req, {
      action: 'workspace_weekly_report.update',
      targetType: 'business_weekly_report',
      targetId: row.id,
      oldValue, newValue: patch,
    });
    return successResponse(res, row.toJSON());
  } catch (err) { next(err); }
});

// ----- DELETE /workspace/:rid — owner only
router.delete('/workspace/:rid', authenticateToken, async (req, res, next) => {
  try {
    const { rid } = req.params;
    const userId = req.user.id;
    const row = await BusinessWeeklyReport.findByPk(rid);
    if (!row) return errorResponse(res, 'not_found', 404);
    const member = await BusinessMember.findOne({
      where: { user_id: userId, business_id: row.business_id },
      attributes: ['role'],
    });
    if (!member || member.role !== 'owner') return errorResponse(res, 'owner_only', 403);
    const snapshot = { week_start: row.week_start, business_id: row.business_id };
    await row.destroy();
    logAudit(req, {
      action: 'workspace_weekly_report.delete',
      targetType: 'business_weekly_report',
      targetId: Number(rid),
      oldValue: snapshot,
    });
    return successResponse(res, { deleted: true });
  } catch (err) { next(err); }
});

// ============================================
// GET /:id — 풀 view (snapshot_data 포함)
// ============================================
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const review = await WeeklyReview.findByPk(id);
    if (!review) return errorResponse(res, 'not_found', 404);

    // 본인 또는 같은 워크스페이스 owner
    const member = await BusinessMember.findOne({
      where: { user_id: userId, business_id: review.business_id },
    });
    if (!member) return errorResponse(res, 'forbidden', 403);

    if (review.user_id !== userId && member.role !== 'owner') {
      return errorResponse(res, 'forbidden', 403);
    }

    return successResponse(res, review.toJSON());
  } catch (err) {
    next(err);
  }
});

// ============================================
// PATCH /:id — retro_note 수정
// body: { retro_note }
// ============================================
router.patch('/:id', authenticateToken, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { retro_note } = req.body;
    const userId = req.user.id;

    const review = await WeeklyReview.findByPk(id);
    if (!review) return errorResponse(res, 'not_found', 404);

    // 본인만 수정 가능
    if (review.user_id !== userId) {
      return errorResponse(res, 'forbidden', 403);
    }

    await review.update({ retro_note: retro_note || null });
    return successResponse(res, review.toJSON());
  } catch (err) {
    next(err);
  }
});

// ============================================
// DELETE /:id — 결산 삭제
// ============================================
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const review = await WeeklyReview.findByPk(id);
    if (!review) return errorResponse(res, 'not_found', 404);

    // 본인 또는 워크스페이스 owner만 삭제 가능
    const member = await BusinessMember.findOne({
      where: { user_id: userId, business_id: review.business_id },
    });
    if (!member) return errorResponse(res, 'forbidden', 403);

    if (review.user_id !== userId && member.role !== 'owner') {
      return errorResponse(res, 'forbidden', 403);
    }

    await review.destroy();
    return successResponse(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
