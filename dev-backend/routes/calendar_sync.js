// routes/calendar_sync.js — 캘린더 동기화 **조치** 라우트 (#242, 2026-08-14)
//
// 왜 별도 파일인가: routes/calendar.js 가 이미 1,200줄을 넘었다(CLAUDE.md 500줄 기준).
//   여기 모인 것은 "일정 CRUD" 가 아니라 **연동을 고치는 행위** — 성격도 권한선도 다르다.
//
// 왜 이 라우트들이 필요한가 (운영 피드백 #242 재신고의 실체)
//   역방향 동기화는 실제로 작동하는데, 사용자는 ①최대 지연을 모르고 ②팀 토큰이 죽은 것을
//   캘린더 화면에서 조치할 수 없고 ③구글에 남은 옛 사본을 손으로 지우라는 안내를 받았다.
//   전부 "고쳤는데 사용자가 그 사실에 도달하지 못하는" 결함이다.
const express = require('express');
const router = express.Router();
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserDaily } = require('../middleware/costGuard');
const { requireOwnerForCloud } = require('./cloud');   // ★ 권한 기준 복붙 금지 — 같은 가드를 재사용
const reverseSync = require('../services/calendarReverseSync');
const orphanCleanup = require('../services/calendarOrphanCleanup');
const backfill = require('../services/calendarWorkspaceBackfill');

// 외부 quota(구글 API)를 쓰는 라우트 — 분+일 이중 윈도우 (운영 안정성 규칙 #1).
//   화면이 mount·복귀 때 자동 호출하므로 분당 상한은 그 자동 호출까지 감안한 값이다.
const syncNowLimit = perUserDaily('cal-sync-now', {
  perMin: 6, perDay: 300, message: '동기화 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
});
const orphanLimit = perUserDaily('cal-orphan', {
  perMin: 3, perDay: 50, message: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
});

/**
 * POST /api/calendar/sync-now/:businessId — 구글 변경분을 **지금** 당겨온다.
 *
 * 화면이 mount·foreground 복귀 시 자동으로 부른다(사용자가 버튼을 눌러야 최신이 되는 것은
 * 떠넘기기다). 버튼은 재연결 직후 즉시 확인용 보조 수단으로 남긴다.
 */
router.post('/sync-now/:businessId', authenticateToken, checkBusinessAccess, ...syncNowLimit, async (req, res, next) => {
  try {
    const bizId = Number(req.params.businessId);
    const io = req.app.get('io');
    // ★ 개인 소스는 **user_id 만** 으로 고른다. `business_id === bizId` 를 걸면,
    //   pickPersonalConn 이 다른 워크스페이스 연결로 폴백한 사용자는 소스 0 이 되어
    //   200 을 받고도 아무 일이 안 일어난다 — "즉시 동기화도 안 된다" 는 새 신고가 된다.
    //   (본인 캘린더만 도는 것이므로 사생활 문제 없음. Fable 설계 게이트 치명-2)
    const filter = (s) => (s.kind === 'workspace'
      ? Number(s.businessId) === bizId
      : Number(s.conn.user_id) === Number(req.user.id));
    const r = await reverseSync.runAll({ io, force: true, filter });
    return successResponse(res, {
      sources: r.sources,
      applied: r.applied,
      skipped: r.skipped,
      busy: r.busy,
      errors: r.errors,
      // 왜 아무것도 안 왔는지 화면이 말할 수 있어야 한다 — 침묵이 이 사고의 본질이었다.
      excluded: r.excluded,
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/calendar/gcal-orphans/:businessId — 구글에 남은 PlanQ 고아 사본 목록 (읽기 전용).
 * 오너 전용 — 워크스페이스 구글 계정의 데이터를 들여다보는 행위다.
 */
router.get('/gcal-orphans/:businessId', authenticateToken, checkBusinessAccess, requireOwnerForCloud, ...orphanLimit, async (req, res, next) => {
  try {
    const r = await orphanCleanup.scanWorkspaceOrphans(Number(req.params.businessId));
    return successResponse(res, {
      supported: r.supported,
      reason: r.reason || null,
      scanned: r.scanned,
      orphans: r.orphans,
      max_per_call: orphanCleanup.MAX_DELETE_PER_CALL,
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/calendar/gcal-orphans/:businessId/cleanup — 선택된 고아만 구글에서 삭제.
 * ★ 전체 삭제 버튼이 아니다. body.gcal_event_ids 로 **선택분**만 받는다.
 */
router.post('/gcal-orphans/:businessId/cleanup', authenticateToken, checkBusinessAccess, requireOwnerForCloud, ...orphanLimit, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.gcal_event_ids) ? req.body.gcal_event_ids : null;
    if (!ids || ids.length === 0) return errorResponse(res, '삭제할 항목을 선택해 주세요', 400);
    const r = await orphanCleanup.cleanupWorkspaceOrphans(Number(req.params.businessId), ids, req.user.id);
    if (r.reason) return errorResponse(res, `정리할 수 없습니다: ${r.reason}`, 400);
    return successResponse(res, r);
  } catch (err) { next(err); }
});

/**
 * POST /api/calendar/workspace-backfill/:businessId — 팀 캘린더로 **밀린 일정 올려보내기**.
 *
 * 재연결 직후 화면이 자동으로 부른다. 권한이 죽어 있던 기간의 일정은 워크스페이스 링크가 아예 없어서,
 * 이것 없이는 재연결해도 구글이 비어 있고 사용자는 "역시 안 되네" 로 끝난다(설계 게이트 치명-5).
 */
router.post('/workspace-backfill/:businessId', authenticateToken, checkBusinessAccess, requireOwnerForCloud, ...orphanLimit, async (req, res, next) => {
  try {
    const io = req.app.get('io');
    const r = await backfill.backfillWorkspace(Number(req.params.businessId), req.user.id, { io });
    return successResponse(res, r);
  } catch (err) { next(err); }
});

module.exports = router;
