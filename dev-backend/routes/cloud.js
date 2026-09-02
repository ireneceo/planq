// 외부 클라우드 (Google Drive) OAuth + 연동 관리 라우트
const express = require('express');
const router = express.Router();
// Business 는 콜백 전용이 되어 cloud_oauth.js 로 옮겨갔다.
const { Op } = require('sequelize');
const { BusinessCloudToken, User } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { requireInternalKey } = require('../utils/internalAuth');
const gdrive = require('../services/gdrive');
const gcal = require('../services/google_calendar');
// googleScopes · oauthLog 는 콜백 전용이라 cloud_oauth.js 로 함께 옮겼다.


// ─── 구성 상태 ───
router.get('/providers', authenticateToken, async (req, res, next) => {
  try {
    successResponse(res, {
      gdrive: { configured: gdrive.isConfigured() },
      gcal:   { configured: gcal.isConfigured() },
    });
  } catch (error) { next(error); }
});

// ─── 비즈니스의 연동 상태 ───
router.get('/status/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const tokens = await BusinessCloudToken.findAll({
      where: { business_id: req.params.businessId },
      include: [{ model: User, as: 'connector', attributes: ['id', 'name'] }]
    });
    const statusMap = {};
    const { hasDriveFull } = require('../services/googleScopes');
    const { GdriveSyncLog } = require('../models');
    for (const t of tokens) {
      // #379 v2 — 역방향 인제스트 상태. 화면이 "권한 대기" 와 "고장" 을 구별해 보여줄 수 있게
      //   **파생 상태**로 내려준다(별도 상태 컬럼을 두지 않는다 — googleScopes 불변식 ③).
      let ingest = null;
      if (t.provider === 'gdrive') {
        const active = hasDriveFull(t.scope) && !!t.root_folder_id && !!t.connected_by;
        let recent = 0;
        try {
          recent = await GdriveSyncLog.count({
            where: {
              business_id: t.business_id, action: 'ingest',
              created_at: { [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            },
          });
        } catch { /* 집계 실패가 설정 화면을 죽이면 안 된다 */ }
        ingest = {
          active,
          // 왜 안 켜졌는가 — 화면이 사용자 언어로 안내할 수 있게 사유를 준다
          reason: active ? 'ok' : (!t.root_folder_id ? 'no_root_folder' : 'scope_missing'),
          recent_30d: recent,
        };
      }
      statusMap[t.provider] = {
        ingest,
        connected: true,
        account_email: t.account_email,
        root_folder_id: t.root_folder_id,
        connected_at: t.connectedAt || t.connected_at,
        connected_by: t.connector ? t.connector.name : null,
        last_error: t.last_error || null,
        last_error_at: t.last_error_at || null,
        // gcal 은 쓰기 권한(calendar.events)이 있어야 일정을 구글로 보낼 수 있다.
        // 동의 화면에서 캘린더 항목 미체크로 연결된 옛 토큰은 여기서 false 로 드러난다.
        sync_enabled: t.sync_enabled !== false,   // 연결 유지 + 동기화만 끔
        scope_ok: t.provider === 'gcal' ? gcal.hasWriteScope(t.scope) : true,
        // ★ 판정식은 services/google_calendar.needsReconnect 한 벌. 캘린더 화면도 같은 함수를 쓴다 —
        //   여기 인라인 정규식으로 두었더니 같은 판정이 두 벌로 갈라질 참이었다.
        needs_reconnect: t.provider === 'gcal'
          ? gcal.needsReconnect(t)
          : /invalid_grant|unauthorized|invalid_credentials|insufficient/i.test(t.last_error || '')
      };
    }
    successResponse(res, statusMap);
  } catch (error) { next(error); }
});

// 클라우드 연동/해제/감시 = 외부 계정 연결 (API 키 등록 수준 민감도). owner/platform_admin 만.
// PERMISSION_MATRIX.md §5.5 — "포트원·팝빌 API 키 등록" 과 동일 카테고리.
function requireOwnerForCloud(req, res, next) {
  if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
    return errorResponse(res, '클라우드 연동은 워크스페이스 오너만 가능합니다', 403);
  }
  next();
}

// ─── Google Drive OAuth 시작 ───
router.post('/connect/gdrive/:businessId', authenticateToken, checkBusinessAccess, requireOwnerForCloud, async (req, res, next) => {
  try {
    if (!gdrive.isConfigured()) return errorResponse(res, 'Google Drive not configured on server', 500);
    const url = gdrive.buildAuthUrl(Number(req.params.businessId), req.user.id);
    successResponse(res, { auth_url: url });
  } catch (error) { next(error); }
});

// ─── OAuth 콜백 ───
// Google 이 이 엔드포인트로 리디렉트. state 로 사용자 복원.
//   콜백 본문은 routes/cloud_oauth.js 로 절출했다 (cloud.js 가 라우트 500줄 한도 초과).
//   여기서 use() 하므로 마운트 경로·라우트 순서는 절출 전과 동일하다.
router.use(require('./cloud_oauth'));

// ─── Google Calendar OAuth 시작 (Google Meet 자동 생성용) ───
// 사이클 N+13: Daily.co 완전 교체. 워크스페이스 owner 가 Google 계정 1개 OAuth →
//   그 calendar 의 events.insert 시 conferenceData.createRequest 로 Meet 링크 자동 발급.
router.post('/connect/gcal/:businessId', authenticateToken, checkBusinessAccess, requireOwnerForCloud, async (req, res, next) => {
  try {
    if (!gcal.isConfigured()) return errorResponse(res, 'Google Calendar not configured on server', 500);
    const url = gcal.buildAuthUrl(Number(req.params.businessId), req.user.id);
    successResponse(res, { auth_url: url });
  } catch (error) { next(error); }
});


// ─── 연동 해제 ───
// ─── 동기화 on/off — 연결은 유지한 채 밀어넣기만 멈춘다 (Irene 요구 2026-07-27) ───
//   해제(disconnect)와 다른 축이다. 해제는 토큰을 버리므로 다시 동의를 받아야 하지만,
//   이건 잠시 꺼두는 것이라 토글만 되돌리면 즉시 재개된다.
router.put('/sync/:provider/:businessId', authenticateToken, checkBusinessAccess, requireOwnerForCloud, async (req, res, next) => {
  try {
    const { provider, businessId } = req.params;
    if (!['gcal', 'gdrive'].includes(provider)) return errorResponse(res, 'invalid_provider', 400);
    const token = await BusinessCloudToken.findOne({ where: { business_id: businessId, provider } });
    if (!token) return errorResponse(res, 'not_connected', 404);
    const enabled = !!req.body?.sync_enabled;
    await token.update({ sync_enabled: enabled });
    require('../services/auditService').logAudit(req, {
      action: enabled ? 'cloud.sync_enable' : 'cloud.sync_disable',
      targetType: 'BusinessCloudToken', targetId: token.id,
      newValue: { provider, sync_enabled: enabled },
    });
    successResponse(res, { provider, sync_enabled: enabled });
  } catch (error) { next(error); }
});

router.delete('/disconnect/:provider/:businessId', authenticateToken, checkBusinessAccess, requireOwnerForCloud, async (req, res, next) => {
  try {
    const { provider, businessId } = req.params;
    if (!['gdrive', 'gcal'].includes(provider)) return errorResponse(res, 'unknown provider', 400);
    // ★ Google 쪽 승인도 함께 해제한다 (개인 연동과 같은 기준). 여태 행만 지워서, 사용자의
    //   Google 계정 "액세스 권한" 목록에 PlanQ 가 남아 "해제했는데 안 된" 것처럼 보였다.
    //   revoke 실패해도 행 삭제는 진행한다 — 사용자 입장에서 해제는 되어야 한다.
    const row = await BusinessCloudToken.findOne({ where: { business_id: businessId, provider } });
    if (row) await require('../services/cloudTokenCrypto').revokeCloudToken(row);
    await BusinessCloudToken.destroy({ where: { business_id: businessId, provider } });
    // 주의: 외부 클라우드의 실제 파일/이벤트는 그대로 남음 (의도된 동작)
    // 사이클 N+21 — audit
    require('../services/auditService').logAudit(req, {
      action: 'cloud.disconnect',
      targetType: 'business_cloud_token',
      targetId: Number(businessId),
      oldValue: { provider },
    });
    successResponse(res, null, 'Disconnected');
  } catch (error) { next(error); }
});

// ─── Q Note 회의자료 Drive 동기화 (내부 API) ───
// Python Q Note 서비스에서 문서 업로드 완료 후 이 엔드포인트로 동기화 요청.
// 인증: INTERNAL_API_KEY 헤더 (Python ↔ Node 내부 통신).
//   ★ `/api/internal/*` 밖이라 nginx deny 가 덮지 않는다 — 관문을 직접 건다 (보안감사 C-2)
router.post('/qnote/sync', requireInternalKey, async (req, res, next) => {
  try {
    const { business_id, session_id, session_title, session_date, document_id, local_path, file_name, mime_type } = req.body || {};
    if (!business_id || !session_id || !local_path || !file_name) {
      return errorResponse(res, 'missing_required_fields', 400);
    }

    const token = await gdrive.getTokenForBusiness(business_id);
    if (!token || !token.root_folder_id) {
      return successResponse(res, { skipped: true, reason: 'no_drive_token' });
    }

    const fs = require('fs');
    if (!fs.existsSync(local_path)) return errorResponse(res, 'local_file_missing', 404);

    const drive = await gdrive.getDriveClient(token);
    const folderId = await gdrive.ensureQnoteSessionFolder(drive, token, {
      sessionId: session_id, sessionTitle: session_title, sessionDate: session_date,
    });
    const stream = fs.createReadStream(local_path);
    const uploaded = await gdrive.uploadFile(drive, {
      name: file_name,
      mimeType: mime_type || 'application/octet-stream',
      body: stream,
      parentId: folderId,
    });

    return successResponse(res, {
      business_id, session_id, document_id,
      gdrive_file_id: uploaded.id,
      gdrive_web_view_link: uploaded.webViewLink,
      folder_id: folderId,
    });
  } catch (err) { console.error('[qnote sync]', err.message); next(err); }
});

// ─── Drive changes.watch 시작 (해당 워크스페이스의 Drive 변경 감시) ───
router.post('/watch/start/:businessId', authenticateToken, checkBusinessAccess, requireOwnerForCloud, async (req, res, next) => {
  try {
    const token = await gdrive.getTokenForBusiness(req.params.businessId);
    if (!token) return errorResponse(res, 'not_connected', 400);

    // 기존 채널 있으면 중지
    if (token.watch_channel_id && token.watch_resource_id) {
      try {
        const drive = await gdrive.getDriveClient(token);
        await gdrive.stopChannel(drive, { channelId: token.watch_channel_id, resourceId: token.watch_resource_id });
      } catch { /* 이미 만료/무효일 수 있음 */ }
    }

    const drive = await gdrive.getDriveClient(token);
    const crypto = require('crypto');
    const channelId = crypto.randomUUID();
    const webhookUrl = `${process.env.APP_URL || 'https://dev.planq.kr'}/api/cloud/webhook/gdrive`;
    const tokenHint = crypto.createHmac('sha256', process.env.JWT_SECRET).update(`biz:${token.business_id}`).digest('hex').slice(0, 32);
    const { channel, startPageToken } = await gdrive.startChangesWatch(drive, {
      channelId, webhookUrl, tokenHint,
    });
    await token.update({
      watch_channel_id: channel.id,
      watch_resource_id: channel.resourceId,
      watch_expires_at: channel.expiration ? new Date(Number(channel.expiration)) : null,
      watch_page_token: startPageToken,
    });
    return successResponse(res, {
      channel_id: channel.id,
      resource_id: channel.resourceId,
      expires_at: channel.expiration ? new Date(Number(channel.expiration)) : null,
    });
  } catch (err) { console.error('[watch start]', err.message); next(err); }
});

// ─── Drive webhook 수신기 — Google 이 호출 (공개, 검증은 header 로) ───
// 첫 호출은 'sync' 타입 (채널 생성 확인). 이후는 파일 변경 시 push.
router.post('/webhook/gdrive', async (req, res) => {
  try {
    const channelId = req.header('x-goog-channel-id');
    const resourceState = req.header('x-goog-resource-state'); // sync | add | remove | update | trash | untrash | change
    const messageNumber = req.header('x-goog-message-number');
    const tokenHeader = req.header('x-goog-channel-token');
    if (!channelId || !resourceState) return res.status(400).send('bad_request');

    // 채널 ID 로 워크스페이스 식별
    const token = await BusinessCloudToken.findOne({ where: { watch_channel_id: channelId } });
    if (!token) return res.status(404).send('channel_not_found');

    // token 검증 (HMAC hint 일치)
    // ★ fail-closed. 예전엔 `if (tokenHeader && ...)` 라 **헤더가 없으면 검증을 통째로 건너뛰었다** —
    //   channelId 만 알면 아무나 이 워크스페이스의 Drive 동기화를 트리거할 수 있었다.
    //   채널을 만드는 경로는 둘뿐이고(routes/cloud.js:195 · services/gdriveWatchCron.js:71)
    //   **둘 다 tokenHint 를 반드시 설정**하므로, 정상 트래픽에는 헤더가 항상 있다.
    //   역방향 동기화 v2 는 이 경로가 **행을 만드는 유입구**가 되므로 그 전에 조인다.
    const crypto = require('crypto');
    const expected = crypto.createHmac('sha256', process.env.JWT_SECRET).update(`biz:${token.business_id}`).digest('hex').slice(0, 32);
    if (tokenHeader !== expected) {
      // 조용히 죽지 않게 남긴다 — 옛 채널이 있어 정상 동기화가 막히는 경우를 구별할 수 있어야 한다.
      console.warn('[gdrive webhook] 토큰 불일치로 거부', {
        channelId, business_id: token.business_id, hasHeader: !!tokenHeader,
      });
      return res.status(403).send('forbidden');
    }

    // sync 호출은 확인용 — 무시
    if (resourceState === 'sync') return res.status(200).end();

    // 실제 변경 목록 조회 (비동기 처리 후 즉시 200 반환)
    res.status(200).end();

    try {
      const drive = await gdrive.getDriveClient(token);
      let pageToken = token.watch_page_token;
      const changes = [];
      while (pageToken) {
        const data = await gdrive.listChanges(drive, pageToken);
        (data.changes || []).forEach((c) => changes.push(c));
        if (data.nextPageToken) { pageToken = data.nextPageToken; continue; }
        if (data.newStartPageToken) {
          await token.update({ watch_page_token: data.newStartPageToken });
        }
        break;
      }
      // ★ #379 — 여태 여기서 **알리기만** 했다. 변경을 PlanQ 파일함에 실제로 반영한다.
      //   정책 정본은 services/gdriveApply.js (정본 축 비대칭 · soft delete · 멱등 에코 흡수 · LWW).
      //   적용 실패가 웹훅 200 을 막으면 구글이 재시도 폭주하므로 여기서 삼키고 로그로 남긴다.
      let applied = null;
      if (changes.length > 0) {
        try {
          const ga = require('../services/gdriveApply');
          applied = await ga.applyChanges(token.business_id, changes, ga.buildApplyCtx(drive, token));
        } catch (e) {
          console.warn('[gdrive webhook] 변경 적용 실패', e.message);
        }
      }
      // Socket.IO 로 해당 워크스페이스에 변경 알림 (UI가 파일 리스트 재조회 트리거)
      const io = req.app.get('io');
      if (io && changes.length > 0) {
        io.to(`business:${token.business_id}`).emit('gdrive:changed', {
          count: changes.length,
          applied,
          message_number: messageNumber,
          state: resourceState,
        });
      }
    } catch (e) { console.error('[gdrive webhook process]', e.message); }
  } catch (err) {
    console.error('[gdrive webhook]', err.message);
    res.status(500).end();
  }
});

// ─── Watch 중지 ───
router.post('/watch/stop/:businessId', authenticateToken, checkBusinessAccess, requireOwnerForCloud, async (req, res, next) => {
  try {
    const token = await gdrive.getTokenForBusiness(req.params.businessId);
    if (!token || !token.watch_channel_id) return successResponse(res, { stopped: false });
    const drive = await gdrive.getDriveClient(token);
    try {
      await gdrive.stopChannel(drive, { channelId: token.watch_channel_id, resourceId: token.watch_resource_id });
    } catch (e) { console.warn('[watch stop]', e.message); }
    await token.update({ watch_channel_id: null, watch_resource_id: null, watch_expires_at: null });
    return successResponse(res, { stopped: true });
  } catch (err) { next(err); }
});

module.exports = router;
// ★ 오너 전용 가드를 export 한다 — 캘린더 쪽 클라우드 조치 라우트(고아 정리·백필)가 **같은 기준**을
//   써야 한다. 복붙하면 한쪽만 바뀌어 권한선이 갈린다 (PERMISSION_MATRIX §5.5).
module.exports.requireOwnerForCloud = requireOwnerForCloud;
