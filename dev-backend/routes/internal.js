// Internal API — 서비스 간 통신 (Q Note Python ↔ Node)
// 인증: x-internal-api-key 헤더 (process.env.INTERNAL_API_KEY 와 동일)
//
// 사용처:
//   - Q Note Python 의 visibility 검사 시 project membership / user project IDs 확인
//
// 절대 외부 노출 금지 (nginx 가 /api/internal/* 차단 또는 localhost 만 허용).

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { ProjectMember, Project, BusinessMember, QnoteUsage, QnoteUsageEvent } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const planEngine = require('../services/plan');
const { notifyPlatformAdmins } = require('../services/platformNotify');
const rateLimit = require('express-rate-limit');

function _currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// InnoDB 데드락/락대기 판별 — storageUsage.js 와 동일 정책(FOR UPDATE 경합 흡수).
function _isTransientLockError(e) {
  const code = e && (e.parent || e.original || {}).code;
  return code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT';
}

const { requireInternalKey } = require('../utils/internalAuth');   // 관문은 한 곳에서만

router.use(requireInternalKey);

// ─── 특정 user 가 특정 project 의 멤버인지 ───
// GET /api/internal/project-membership/:userId/:projectId
router.get('/project-membership/:userId/:projectId', async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const projectId = Number(req.params.projectId);
    if (!userId || !projectId) return errorResponse(res, 'invalid_ids', 400);

    const pm = await ProjectMember.findOne({
      where: { user_id: userId, project_id: projectId },
      attributes: ['user_id', 'role'],
    });
    if (pm) return successResponse(res, { member: true, role: pm.role });

    // 프로젝트 owner 의 워크스페이스 오너도 멤버로 간주
    const project = await Project.findByPk(projectId, { attributes: ['business_id'] });
    if (!project) return successResponse(res, { member: false });
    const bm = await BusinessMember.findOne({
      where: { user_id: userId, business_id: project.business_id, role: 'owner' },
      attributes: ['user_id'],
    });
    return successResponse(res, { member: !!bm, role: bm ? 'workspace_owner' : null });
  } catch (err) { next(err); }
});

// ─── 사용자의 project IDs ───
// GET /api/internal/user-project-ids/:userId?business_id=N
router.get('/user-project-ids/:userId', async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const businessId = req.query.business_id ? Number(req.query.business_id) : null;
    if (!userId) return errorResponse(res, 'invalid_user_id', 400);

    const where = { user_id: userId };
    const rows = await ProjectMember.findAll({
      where,
      attributes: ['project_id'],
      include: businessId
        ? [{ model: Project, attributes: ['id', 'business_id'], where: { business_id: businessId }, required: true }]
        : [],
    });
    const projectIds = rows.map((r) => r.project_id);

    // 워크스페이스 owner 는 자기 워크스페이스의 모든 project 멤버로 간주
    if (businessId) {
      const bm = await BusinessMember.findOne({
        where: { user_id: userId, business_id: businessId, role: 'owner' },
      });
      if (bm) {
        const allProjects = await Project.findAll({
          where: { business_id: businessId },
          attributes: ['id'],
        });
        for (const p of allProjects) {
          if (!projectIds.includes(p.id)) projectIds.push(p.id);
        }
      }
    }
    return successResponse(res, { project_ids: projectIds });
  } catch (err) { next(err); }
});

// ─── Q Note STT 과금 (C1) ─────────────────────────────────────────────
// 설계: docs/QNOTE_STT_BILLING_DESIGN.md §3.6

// business membership 확인 — q-note create_session / /ws/live hard-block 용.
//   BusinessMember(removed_at IS NULL) — owner 도 BusinessMember 행이라 포함. Client 제외(Q Note 차단).
// GET /api/internal/business-membership/:userId/:businessId
router.get('/business-membership/:userId/:businessId', async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const businessId = Number(req.params.businessId);
    if (!userId || !businessId) return errorResponse(res, 'invalid_ids', 400);
    const bm = await BusinessMember.findOne({
      where: { user_id: userId, business_id: businessId, removed_at: null },
      attributes: ['user_id', 'role'],
    });
    return successResponse(res, { member: !!bm, role: bm ? bm.role : null });
  } catch (err) { next(err); }
});

// Q Note 월 한도 게이트 — Deepgram 연결 전 hard-block 판정.
// GET /api/internal/qnote/can?business_id=N&seconds=S
router.get('/qnote/can', async (req, res, next) => {
  try {
    const bizId = Number(req.query.business_id);
    const seconds = req.query.seconds != null ? Number(req.query.seconds) : 1;
    if (!bizId) return errorResponse(res, 'invalid_business_id', 400);
    // ★ 마지막 안전망 — 플랫폼 선불 크레딧이 마르면 Deepgram 이 우리 요청을 거절한다.
    //   그때 사용자가 보는 것은 원인 모를 접속 실패다. 그 전에 **사유를 갖고** 막는다.
    //   (진짜 대응은 소진 전 충전 경보 — services/providerCredit.runCreditAlerts)
    //   기준선 미설정이거나 판정 실패면 fail-open 이라 이 줄이 서비스를 죽이지 않는다.
    const credit = await require('../services/providerCredit').allow('deepgram');
    if (!credit.ok) {
      return successResponse(res, {
        ok: false, reason: 'platform_credit_exhausted', limit: null, current: null,
      });
    }
    const r = await planEngine.can(bizId, 'use_qnote', { seconds });
    return successResponse(res, r);
  } catch (err) { next(err); }
});

// STT 사용량 세그먼트 기록 — 멱등 원장 + 월 rollup 원자 증가(정확히 한 번).
async function _attemptRecordUsage(args) {
  const { streamId, seq, sessionId, bizId, userId, secs, isStereo } = args;
  const ym = _currentYearMonth();
  const t = await sequelize.transaction();
  try {
    // 멱등 원장 — UNIQUE(stream_id, segment_seq) 충돌이면 이미 집계된 세그먼트(중복 skip).
    let inserted = true;
    try {
      await QnoteUsageEvent.create({
        stream_id: streamId, segment_seq: seq, session_id: sessionId,
        business_id: bizId, user_id: userId, seconds: secs, is_stereo: isStereo,
      }, { transaction: t });
    } catch (e) {
      if (e.name === 'SequelizeUniqueConstraintError') inserted = false;
      else throw e;
    }
    if (!inserted) {
      await t.commit();
      return { counted: false, duplicate: true };
    }
    // 신규 삽입일 때만 월 rollup 을 FOR UPDATE 잠그고 증가.
    await QnoteUsage.findOrCreate({
      where: { business_id: bizId, year_month: ym },
      defaults: { business_id: bizId, year_month: ym, seconds_used: 0, minutes_used: 0, session_count: 0, cost_usd: 0 },
      transaction: t,
    });
    const row = await QnoteUsage.findOne({
      where: { business_id: bizId, year_month: ym },
      lock: t.LOCK.UPDATE, transaction: t,
    });
    const newSeconds = Number(row.seconds_used || 0) + secs;
    row.seconds_used = newSeconds;
    row.minutes_used = Math.floor(newSeconds / 60);
    // ★ 2026-08-24 — 여태 cost_usd 는 0 으로 **초기화만** 되고 누적이 없었다.
    //   초는 세는데 돈은 안 세서, 원장을 봐도 STT 가 공짜처럼 보였다(운영 실측: 44분 사용 / $0.00).
    //   seconds 는 이미 billed 초(스테레오 2배 반영)라 그대로 분 환산해 곱한다.
    //   단가는 보정된 실단가를 우선 쓴다(60초 캐시라 세그먼트마다 DB 를 치지 않는다).
    const _rate = await require('../services/providerCredit').getDeepgramRate();
    row.cost_usd = Number(Number(row.cost_usd || 0) + (secs / 60) * _rate).toFixed(4);
    if (seq === 0) row.session_count = Number(row.session_count || 0) + 1;  // 연결 최초 세그먼트 = 새 녹음 1건
    await row.save({ transaction: t });
    await t.commit();
    planEngine.invalidateBusinessCache(bizId);
    return { counted: true, seconds_used: newSeconds, minutes_used: Math.floor(newSeconds / 60) };
  } catch (e) {
    try { await t.rollback(); } catch (_) { /* already settled */ }
    throw e;
  }
}

// POST /api/internal/qnote/usage  { stream_id, segment_seq, session_id, business_id, user_id, seconds, is_stereo }
router.post('/qnote/usage', async (req, res, next) => {
  try {
    const b = req.body || {};
    const streamId = String(b.stream_id || '').slice(0, 36);
    const seq = Number(b.segment_seq);
    const bizId = Number(b.business_id);
    const secs = Math.max(0, Math.round(Number(b.seconds) || 0));
    if (!streamId || !Number.isInteger(seq) || seq < 0 || !bizId) {
      return errorResponse(res, 'invalid_usage_payload', 400);
    }
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await _attemptRecordUsage({
          streamId, seq, sessionId: Number(b.session_id) || 0, bizId,
          userId: Number(b.user_id) || 0, secs, isStereo: !!b.is_stereo,
        });
        break;
      } catch (e) {
        if (_isTransientLockError(e) && attempt < 2) {
          await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }
    return successResponse(res, result);
  } catch (err) { next(err); }
});

// flush 연속 실패 → platform_admin 알림 (best-effort, 운영 안정성 #8).
// POST /api/internal/qnote/alert  { user_id, business_id, message }
router.post('/qnote/alert', async (req, res, next) => {
  try {
    const b = req.body || {};
    await notifyPlatformAdmins({
      eventKind: 'feedback',
      title: 'Q Note 과금 기록 실패',
      body: `q-note STT usage flush 연속 실패 (user ${b.user_id || '?'}, business ${b.business_id || '?'}): ${String(b.message || '').slice(0, 200)}`,
    }).catch(() => {});
    return successResponse(res, { alerted: true });
  } catch (err) { next(err); }
});

// ─── PDF 렌더 헬스체크 (#253 재발 검출) ───
//
// 왜 HTTP 엔드포인트인가:
//   운영의 헤드리스 Chrome 공유 라이브러리 경로(LD_LIBRARY_PATH)는 백엔드 .env 에 있고,
//   dotenv 가 process.env 에 넣어야 puppeteer 가 띄우는 chrome **자식 프로세스가 상속**한다.
//   즉 실제로 PDF 를 서빙하는 **백엔드 프로세스 자신이 렌더해야** 운영 상태를 정확히 잰다.
//   별도 `node -e` 프로세스로 재면 환경이 달라 거짓 PASS/FAIL 이 난다.
//
// #253: 운영에만 라이브러리가 없어 pdfService(단일 착지점) 하나가 죽었고,
//   공개 미리보기·청구서·문서·Q info·보고서·정기청구 메일 PDF 6개 기능이 동시에 500 이었다.
//   dev 는 e2e 하니스 때문에 라이브러리가 있어 코드 검증으로는 영원히 안 잡히는 계열.
//
// 인증: 파일 상단 router.use(requireInternalKey) 가 자동 적용 (x-internal-api-key).
// rate-limit: chrome 렌더는 비싸다. internal 라우트엔 req.user 가 없으므로 고정키 캡.
const pdfHealthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: () => 'internal-health-pdf',
  message: { success: false, message: 'too_many_requests' },
});

// GET /api/internal/health/pdf → 고정 HTML 을 실제로 렌더해 %PDF- 매직 확인
router.get('/health/pdf', pdfHealthLimiter, async (req, res, next) => {
  try {
    const { renderPdfFromHtml } = require('../services/pdfService');
    const html = '<html><body><h1>PlanQ PDF health</h1><p>renderer alive</p></body></html>';
    const pdf = await renderPdfFromHtml(html);
    const buf = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    const magicOk = buf.slice(0, 5).toString('latin1') === '%PDF-';
    if (!magicOk || buf.length < 1000) {
      return errorResponse(res, `pdf_invalid — bytes=${buf.length} magic=${buf.slice(0, 5).toString('latin1')}`, 500);
    }
    return successResponse(res, { bytes: buf.length, magic_ok: true });
  } catch (err) {
    // 렌더 실패는 500 으로 표면화 — 헬스체크가 판정할 수 있어야 한다(조용한 통과 금지).
    return errorResponse(res, `pdf_render_failed — ${String(err.message || err).slice(0, 300)}`, 500);
  }
});

module.exports = router;
