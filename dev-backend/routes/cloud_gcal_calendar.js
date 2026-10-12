// routes/cloud_gcal_calendar.js — 팀 Google 캘린더 «팀 일정을 올릴 캘린더» 고르기
//
// 설계 docs/TEAM_CALENDAR_PICK_DESIGN.md §2 (Fable 설계 · 2026-10-12 Irene «권고대로»: D1 올릴 캘린더 하나만 · D2 대표만).
// 마운트는 cloud.js 가 한다(router.use) — 경로 /api/cloud/gcal/:businessId/…
//
// ★ 여러 개를 고르는 칸이 아니다. 한 일정 = 한 캘린더라 쓰기는 본질상 하나다.
//   회사 계정의 다른 캘린더를 팀원에게 **읽어 오지 않는다** — 토큰이 대표 개인 계정이라 사적 일정이 새기 때문이다.
//   팀원이 볼 공유 캘린더는 각자 개인 연동 «보일 캘린더» 에서 켠다.
// ★ 이미 올린 일정은 옮기지 않는다 — 수정·삭제는 링크의 gcal_calendar_id 로 옛 캘린더에서 계속된다.
const express = require('express');
const router = express.Router();
const { BusinessCloudToken } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserLimiter } = require('../middleware/costGuard');
const gcal = require('../services/google_calendar');

// cloud.js 의 같은 이름 가드와 **같은 술어**여야 한다(연결·해제와 같은 사람 = 대표).
function requireOwnerForCloud(req, res, next) {
  if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
    return errorResponse(res, '클라우드 연동은 워크스페이스 오너만 가능합니다', 403);
  }
  next();
}

// 구글 calendarList 호출은 외부 quota — 분당 30.
const listLimiter = perUserLimiter('gcal-team-calendars', { windowMs: 60 * 1000, max: 30 });

async function tokenOf(businessId) {
  return await BusinessCloudToken.findOne({ where: { business_id: Number(businessId), provider: 'gcal' } });
}

// GET /api/cloud/gcal/:businessId/calendars — 올릴 수 있는 캘린더(writer/owner) 목록
router.get('/gcal/:businessId/calendars', authenticateToken, checkBusinessAccess, requireOwnerForCloud, listLimiter, async (req, res, next) => {
  try {
    const token = await tokenOf(req.params.businessId);
    if (!token) return errorResponse(res, 'not_connected', 404, 'not_connected');
    const selected = gcal.calendarIdOf(token);
    const base = { selected, selected_summary: token.gcal_calendar_id ? (token.gcal_calendar_summary || null) : null };
    // 목록 권한이 없는 옛 연결 — 화면이 «목록 권한을 포함해 다시 연결» 로 안내한다.
    if (!gcal.canListCalendars(token)) return successResponse(res, { can_list: false, ...base, calendars: [] });
    let calendars;
    try {
      calendars = await gcal.listWritableCalendars(token);
    } catch (e) {
      const code = e && (e.code || e.status);
      if (code === 401 || code === 403) return successResponse(res, { can_list: false, ...base, calendars: [] });
      throw e;
    }
    return successResponse(res, { can_list: true, ...base, calendars });
  } catch (err) { next(err); }
});

// PUT /api/cloud/gcal/:businessId/calendar-id { calendar_id } — 팀 일정을 올릴 캘린더 바꾸기
router.put('/gcal/:businessId/calendar-id', authenticateToken, checkBusinessAccess, requireOwnerForCloud, listLimiter, async (req, res, next) => {
  try {
    const token = await tokenOf(req.params.businessId);
    if (!token) return errorResponse(res, 'not_connected', 404, 'not_connected');
    const wanted = String((req.body && req.body.calendar_id) || '').trim();
    if (!wanted) return errorResponse(res, 'calendar_id_required', 400, 'calendar_id_required');
    if (!gcal.canListCalendars(token)) return errorResponse(res, 'calendar_list_scope_missing', 400, 'calendar_list_scope_missing');
    // 손으로 넣은 id 를 믿지 않는다 — 지금 구글 목록(writer/owner)에 있는 것만.
    const list = await gcal.listWritableCalendars(token);
    const hit = list.find((c) => c.id === wanted);
    if (!hit) return errorResponse(res, 'calendar_not_writable', 400, 'calendar_not_writable');

    const prev = gcal.calendarIdOf(token);
    const nextId = hit.primary ? null : hit.id;          // primary = NULL 저장(옛 행과 같은 뜻)
    const nextSummary = hit.primary ? null : (hit.summary || null);
    const changed = prev !== (nextId || 'primary');
    const patch = { gcal_calendar_id: nextId, gcal_calendar_summary: nextSummary };
    // 바뀌면 역방향 동기화 커서를 비운다 — 새 캘린더를 처음부터(부트스트랩) 읽는다.
    if (changed) patch.gcal_sync_token = null;
    await token.update(patch);

    if (changed) {
      // 감사 — id 만(이름·일정 내용 없음)
      require('../services/auditService').logAudit(req, {
        action: 'cloud.calendar_select', targetType: 'business_cloud_token', targetId: token.id,
        oldValue: { calendar_id: prev }, newValue: { calendar_id: nextId || 'primary' },
      });
      // 신호만 — 받는 화면은 상태를 다시 읽는다(행 전체를 방에 뿌리지 않는다).
      const io = req.app.get('io');
      if (io) io.to(`business:${token.business_id}`).emit('cloud:updated', { provider: 'gcal', business_id: token.business_id });
    }
    return successResponse(res, {
      selected: nextId || 'primary', selected_summary: nextSummary, changed,
      primary: !!hit.primary, access_role: hit.access_role,
    });
  } catch (err) { next(err); }
});

module.exports = router;
