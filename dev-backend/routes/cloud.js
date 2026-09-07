// 외부 클라우드 (Google Drive) OAuth + 연동 관리 라우트
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
// Business — 저장 위치 지정 시 새 루트 폴더 이름(`PlanQ - <워크스페이스>`)에 쓴다.
//   ★ 생성 키는 cloud_oauth 콜백과 **같아야** 한다(biz.name). 다르면 자가복구가 다른 폴더를 가리킨다.
const { BusinessCloudToken, User, Business } = require('../models');
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
      // PlanQ 폴더가 **어디 있는가** — 내 드라이브인가, 공유(팀) 드라이브인가.
      //   Irene 은 팀 드라이브 중심을 계속 요구했는데 화면이 위치를 말해 주지 않아
      //   "제대로 적용됐는지" 를 확인할 방법이 없었다.
      //   ★ drive.file scope 는 **앱이 만든 파일을 계속 따라간다** — 사용자가 폴더를
      //     공유 드라이브로 끌어다 놓아도 접근권이 유지된다. 그래서 "옮기세요" 안내가 성립한다.
      //   ★ 실패해도 설정 화면을 죽이지 않는다(연결 상태 자체는 이미 알고 있다).
      let folder = null;
      if (t.provider === 'gdrive' && t.root_folder_id) {
        try {
          const gd = require('../services/gdrive');
          const drive = await gd.getDriveClient(t);
          const r = await drive.files.get({
            fileId: t.root_folder_id,
            fields: 'id, name, driveId, webViewLink, trashed',
            supportsAllDrives: true,
          });
          folder = {
            id: r.data.id,
            name: r.data.name,
            web_view_link: r.data.webViewLink || null,
            // driveId 가 있으면 공유(팀) 드라이브 안이다. 없으면 연결한 사람의 내 드라이브.
            in_shared_drive: !!r.data.driveId,
            trashed: !!r.data.trashed,
            reachable: true,
          };
        } catch (e) {
          // 404 는 "연결이 죽었다" 가 아니라 "가리키는 곳이 틀렸다" 일 수 있다 —
          //   업로드·목록 경로의 ensureRootFolder 가 다음 사용 때 스스로 고친다.
          folder = { reachable: false, reason: String(e.message).slice(0, 120) };
        }
      }

      statusMap[t.provider] = {
        ingest,
        folder,
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
// ─── 저장 위치 지정 (공유/팀 드라이브) ───────────────────
// PUT /api/cloud/gdrive/:businessId/root-folder  { location: "<Drive 폴더 URL 또는 ID>" }
//
// Irene 2026-09-07: 팀 드라이브로 폴더를 옮기려는데 **자꾸 되돌아간다**.
//   원인은 PlanQ 가 아니었다 — Finder(구글 드라이브 데스크톱)에서는 내 드라이브 → 공유 드라이브
//   이동이 소유권 이전이라 처리되지 않고 되돌아간다. 그리고 워크스페이스 관리 설정이
//   그 이동을 막고 있을 수도 있다. 어느 쪽이든 **사용자에게는 이유 없이 되돌아가는 것**으로만 보인다.
//
// 그래서 앱이 대신 한다. 핵심 실측(2026-09-07):
//   ★ `drive.file` scope 로도 **우리가 볼 수 없는 폴더를 부모로 지정해 만들 수 있다.**
//     그래서 공유 드라이브 폴더의 주소(ID)만 알면 되고, Picker 도 제한 권한도 필요 없다.
//   ★ 옮기기(move)가 정책으로 막혀 있어도 **거기에 새로 만드는 것**은 별개 동작이라 된다.
//     그래서 옮기기를 먼저 시도하고, 안 되면 새로 만든다 — 그리고 **무엇을 했는지 말한다.**
router.put('/gdrive/:businessId/root-folder', authenticateToken, checkBusinessAccess, requireOwnerForCloud,
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const raw = String(req.body?.location || '').trim();
      if (!raw) return errorResponse(res, 'location_required', 400);

      // URL 이든 ID 든 받는다 — 사용자는 주소창을 복사해 온다.
      //   .../folders/<id> · .../drive/folders/<id>?... · open?id=<id> · 그냥 <id>
      const m = raw.match(/\/folders\/([A-Za-z0-9_-]{10,})/)
        || raw.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
        || raw.match(/^([A-Za-z0-9_-]{10,})$/);
      if (!m) return errorResponse(res, 'invalid_folder_location', 400);
      const targetId = m[1];

      const token = await BusinessCloudToken.findOne({
        where: { business_id: businessId, provider: 'gdrive' },
      });
      if (!token) return errorResponse(res, 'workspace_drive_not_connected', 400);

      const drive = await gdrive.getDriveClient(token);
      const oldRoot = token.root_folder_id;
      // ★ 새로 만들기는 **사용자가 명시적으로 허락했을 때만** 한다.
      //   옮기기가 실패했다고 자동으로 새로 만들면, 전이 오류(500·타임아웃) 한 번에
      //   폴더가 둘로 갈라지고 옛 파일이 남겨진다 — 오늘 Fable 이 잡은 것과 **같은 함정**이다
      //   (services/gdrive.ensureRootFolder 2026-09-07). 그래서 두 번 나눠 묻는다.
      const allowCreate = req.body?.allow_create === true;
      let how = null;
      let newRoot = null;

      // ① 기존 폴더를 그대로 옮긴다 — 파일이 따라가므로 이게 가장 좋다.
      let moveError = null;
      if (oldRoot) {
        try {
          const meta = await drive.files.get({ fileId: oldRoot, fields: 'parents', supportsAllDrives: true });
          const prev = (meta.data.parents || []).join(',');
          await drive.files.update({
            fileId: oldRoot,
            addParents: targetId,
            ...(prev ? { removeParents: prev } : {}),
            fields: 'id', supportsAllDrives: true,
          });
          newRoot = oldRoot;
          how = 'moved';
        } catch (e) {
          moveError = String(e.message || '').slice(0, 160);
          console.warn('[gdrive] 루트 폴더 이동 실패:', moveError);
        }
      }

      // ② 옮기기가 안 됐다 — **자동으로 새로 만들지 않는다.** 왜 안 됐는지 알리고,
      //    "그 위치에 새로 만들기" 를 사용자가 다시 눌렀을 때만 만든다.
      if (!newRoot && !allowCreate) {
        return errorResponse(res, `move_failed_confirm_create: ${moveError || 'unknown'}`, 409);
      }

      if (!newRoot) {
        try {
          const biz = await Business.findByPk(businessId, { attributes: ['name'] });
          const r = await drive.files.create({
            requestBody: {
              name: `PlanQ - ${(biz && biz.name) || 'workspace'}`,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [targetId],
              appProperties: { planqBusinessId: String(businessId) },
            },
            fields: 'id', supportsAllDrives: true,
          });
          newRoot = r.data.id;
          how = 'created';
        } catch (e) {
          // 여기까지 실패하면 목적지 자체를 쓸 수 없다 — 사용자에게 이유를 그대로 준다.
          return errorResponse(res, `folder_unusable: ${String(e.message).slice(0, 160)}`, 400);
        }
      }

      // ③ 정말 그리로 갔는지 **다시 읽어서** 확인한다. 말만 하고 안 확인하면 또 "된 건가?" 가 된다.
      let placed;
      try {
        const chk = await drive.files.get({
          fileId: newRoot, fields: 'id, name, driveId, webViewLink', supportsAllDrives: true,
        });
        placed = chk.data;
      } catch (e) {
        return errorResponse(res, `folder_unreadable_after_change: ${String(e.message).slice(0, 160)}`, 502);
      }

      // 하위 캐시는 옛 루트 기준이라 비운다 — 안 비우면 새 루트 아래에 옛 폴더를 찾으려 든다.
      await token.update({
        root_folder_id: newRoot,
        workspace_folder_id: null,
        conversations_folder_id: null,
        qnote_folder_id: null,
        last_error: null,
      });
      require('../services/auditService').createAuditLog({
        action: 'cloud.gdrive_root_changed', targetType: 'business', targetId: businessId,
        businessId, userId: req.user.id,
        oldValue: { root_folder_id: oldRoot },
        newValue: { root_folder_id: newRoot, how, in_shared_drive: !!placed.driveId },
      });

      return successResponse(res, {
        how,                                   // 'moved' = 기존 파일이 따라갔다 · 'created' = 새 폴더
        folder: {
          id: placed.id,
          name: placed.name,
          web_view_link: placed.webViewLink || null,
          in_shared_drive: !!placed.driveId,
          reachable: true,
        },
        previous_root_folder_id: oldRoot,      // 'created' 면 옛 파일은 아직 저기 있다
      });
    } catch (err) { next(err); }
  });

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
