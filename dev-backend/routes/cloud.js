// 외부 클라우드 (Google Drive) OAuth + 연동 관리 라우트
const express = require('express');
const router = express.Router();
const { BusinessCloudToken, Business, User } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const gdrive = require('../services/gdrive');
const gcal = require('../services/google_calendar');

// 사이클 N+16-B — OAuth 콜백 팝업 자동 닫기 + COOP 차단 시 사용자 친화 안내.
// 옛 버전: 300ms 후 postMessage + 사용자가 직접 "닫기" 클릭 → 일부 브라우저(Chrome/Safari)가
// Cross-Origin-Opener-Policy 로 window.close() 차단 → 닫기 안 됨.
// 새 버전:
//   1) 즉시 postMessage (부모가 상태 갱신)
//   2) 800ms 뒤 자동 window.close() 시도
//   3) 1.5s 후에도 살아있으면 안내 화면 ("이 창을 닫으셔도 됩니다") 로 교체
function buildCallbackHtml({ provider, ok, title, body }) {
  // provider: 'gdrive' | 'gcal' (postMessage type 분기)
  const messageType = provider === 'gcal' ? 'gcal:connected' : 'gdrive:connected';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#F8FAFC;color:#0F172A;}
  .box{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:28px 32px;max-width:420px;text-align:center;box-shadow:0 4px 12px rgba(15,23,42,0.06);}
  h2{margin:0 0 10px;font-size:18px;color:${ok ? '#0F766E' : '#DC2626'};}
  p{margin:0 0 16px;font-size:13px;color:#475569;line-height:1.55;}
  button{height:36px;padding:0 18px;background:#14B8A6;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;}
  button:hover{background:#0D9488;}
  .hint{font-size:11.5px;color:#94A3B8;margin-top:6px;}
  #fallback{display:none;}
</style></head>
<body>
  <div class="box" id="primary">
    ${body}
    <button type="button" id="closeBtn">닫기</button>
    <div class="hint">잠시 후 자동으로 닫힙니다…</div>
  </div>
  <div class="box" id="fallback">
    <h2 style="color:#0F766E;">✓ 완료</h2>
    <p>이 창을 닫으셔도 됩니다.<br/>브라우저 보안 정책으로 자동 닫기가 막힌 환경입니다.</p>
  </div>
  <script>
    (function(){
      // 1) 부모 창에 결과 즉시 통보 (실패 안전)
      try { window.opener && window.opener.postMessage({ type: ${JSON.stringify(messageType)}, ok: ${ok ? 'true' : 'false'} }, '*'); } catch(e){}
      var tryClose = function(){
        try { window.close(); } catch(e){}
      };
      // 2) 닫기 버튼
      document.getElementById('closeBtn').addEventListener('click', tryClose);
      // 3) 800ms 후 자동 닫기 시도
      setTimeout(tryClose, 800);
      // 4) 1.5s 후 닫혀 있지 않으면 안내 화면으로 교체 (COOP 차단된 경우)
      setTimeout(function(){
        if (!document.hidden) {
          var p = document.getElementById('primary');
          var f = document.getElementById('fallback');
          if (p && f) { p.style.display = 'none'; f.style.display = 'block'; }
        }
      }, 1500);
    })();
  </script>
</body></html>`;
}

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
    for (const t of tokens) {
      statusMap[t.provider] = {
        connected: true,
        account_email: t.account_email,
        root_folder_id: t.root_folder_id,
        connected_at: t.connectedAt || t.connected_at,
        connected_by: t.connector ? t.connector.name : null
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
router.get('/callback/gdrive', async (req, res) => {
  const { code, state, error: oauthError } = req.query;
  const ok = (title, body) => buildCallbackHtml({ provider: 'gdrive', ok: !title.includes('실패'), title, body });

  if (oauthError) {
    return res.status(400).send(ok('연동 실패', `<h2>연동 실패</h2><p>Google 에서 거부됨: ${oauthError}</p>`));
  }
  if (!code || !state) {
    return res.status(400).send(ok('연동 실패', '<h2>연동 실패</h2><p>잘못된 요청</p>'));
  }

  const parsed = gdrive.parseState(state);
  if (!parsed) return res.status(400).send(ok('연동 실패', '<h2>연동 실패</h2><p>state 검증 실패</p>'));

  try {
    // 토큰 교환
    const { tokens, accountEmail } = await gdrive.exchangeCodeForTokens(code);

    // 기존 연동 있으면 업데이트, 없으면 생성
    const [record] = await BusinessCloudToken.findOrCreate({
      where: { business_id: parsed.businessId, provider: 'gdrive' },
      defaults: {
        business_id: parsed.businessId,
        provider: 'gdrive',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: tokens.scope,
        account_email: accountEmail,
        connected_by: parsed.userId,
        connected_at: new Date()
      }
    });
    // 기존 레코드면 갱신
    record.access_token = tokens.access_token;
    if (tokens.refresh_token) record.refresh_token = tokens.refresh_token;
    record.expires_at = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
    record.scope = tokens.scope || record.scope;
    record.account_email = accountEmail || record.account_email;
    record.connected_by = parsed.userId;
    record.connected_at = new Date();

    // 루트 폴더 확보 (없으면)
    // 사이클 N+19 hotfix — disconnect→reconnect 시 Drive 에 옛 "PlanQ - {bizName}" 폴더가
    // 남아 있으면 그것을 재사용. drive.file scope 라 PlanQ 가 직접 만든 폴더만 검색 가능.
    // 같은 이름 폴더 2개 이상이면 createdTime ASC 첫 번째 (가장 오래된 — 진짜 옛 폴더).
    if (!record.root_folder_id) {
      const biz = await Business.findByPk(parsed.businessId);
      const bizName = biz ? biz.name : 'workspace';
      const targetName = `PlanQ - ${bizName}`;
      const drive = await gdrive.getDriveClient(record);
      let folderId = null;
      try {
        const list = await drive.files.list({
          q: `name='${targetName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: 'files(id, name, createdTime)',
          orderBy: 'createdTime',
          pageSize: 1,
        });
        if (list.data.files && list.data.files.length > 0) {
          folderId = list.data.files[0].id;
          console.log('[gdrive callback] reusing existing root folder for biz=' + parsed.businessId + ' folder=' + folderId);
        }
      } catch (e) {
        console.warn('[gdrive callback] root folder search failed:', e.message);
      }
      if (!folderId) {
        const root = await gdrive.createRootFolder(drive, bizName);
        folderId = root.id;
      }
      record.root_folder_id = folderId;
    }
    await record.save();

    return res.send(buildCallbackHtml({
      provider: 'gdrive', ok: true, title: '연동 완료',
      body: `<h2>Google Drive 연동 완료</h2><p>계정: <strong>${accountEmail || '(확인 불가)'}</strong><br/>루트 폴더 생성됨.</p>`,
    }));
  } catch (e) {
    console.error('[gdrive callback]', e);
    return res.status(500).send(buildCallbackHtml({
      provider: 'gdrive', ok: false, title: '연동 실패',
      body: `<h2>연동 실패</h2><p>${e.message || '서버 오류'}</p>`,
    }));
  }
});

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

router.get('/callback/gcal', async (req, res) => {
  const { code, state, error: oauthError } = req.query;
  const ok = (title, body) => buildCallbackHtml({ provider: 'gcal', ok: !title.includes('실패'), title, body });

  if (oauthError) {
    return res.status(400).send(ok('연동 실패', `<h2>연동 실패</h2><p>Google 에서 거부됨: ${oauthError}</p>`));
  }
  if (!code || !state) {
    return res.status(400).send(ok('연동 실패', '<h2>연동 실패</h2><p>잘못된 요청</p>'));
  }
  const parsed = gcal.parseState(state);
  if (!parsed) return res.status(400).send(ok('연동 실패', '<h2>연동 실패</h2><p>state 검증 실패</p>'));

  try {
    const { tokens, accountEmail } = await gcal.exchangeCodeForTokens(code);

    const [record] = await BusinessCloudToken.findOrCreate({
      where: { business_id: parsed.businessId, provider: 'gcal' },
      defaults: {
        business_id: parsed.businessId,
        provider: 'gcal',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: tokens.scope,
        account_email: accountEmail,
        connected_by: parsed.userId,
        connected_at: new Date(),
      },
    });
    record.access_token = tokens.access_token;
    if (tokens.refresh_token) record.refresh_token = tokens.refresh_token;
    record.expires_at = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
    record.scope = tokens.scope || record.scope;
    record.account_email = accountEmail || record.account_email;
    record.connected_by = parsed.userId;
    record.connected_at = new Date();
    await record.save();

    return res.send(buildCallbackHtml({
      provider: 'gcal', ok: true, title: '연동 완료',
      body: `<h2>Google Calendar 연동 완료</h2><p>계정: <strong>${accountEmail || '(확인 불가)'}</strong><br/>화상회의 시 Google Meet 링크가 자동으로 만들어집니다.</p>`,
    }));
  } catch (e) {
    console.error('[gcal callback]', e);
    return res.status(500).send(buildCallbackHtml({
      provider: 'gcal', ok: false, title: '연동 실패',
      body: `<h2>연동 실패</h2><p>${e.message || '서버 오류'}</p>`,
    }));
  }
});

// ─── 연동 해제 ───
router.delete('/disconnect/:provider/:businessId', authenticateToken, checkBusinessAccess, requireOwnerForCloud, async (req, res, next) => {
  try {
    const { provider, businessId } = req.params;
    if (!['gdrive', 'gcal'].includes(provider)) return errorResponse(res, 'unknown provider', 400);
    await BusinessCloudToken.destroy({ where: { business_id: businessId, provider } });
    // 주의: 외부 클라우드의 실제 파일/이벤트는 그대로 남음 (의도된 동작)
    successResponse(res, null, 'Disconnected');
  } catch (error) { next(error); }
});

// ─── Q Note 회의자료 Drive 동기화 (내부 API) ───
// Python Q Note 서비스에서 문서 업로드 완료 후 이 엔드포인트로 동기화 요청.
// 인증: INTERNAL_API_KEY 헤더 (Python ↔ Node 내부 통신).
router.post('/qnote/sync', async (req, res, next) => {
  try {
    const key = req.header('x-internal-api-key');
    if (!process.env.INTERNAL_API_KEY || key !== process.env.INTERNAL_API_KEY) {
      return errorResponse(res, 'forbidden', 403);
    }
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
    const crypto = require('crypto');
    const expected = crypto.createHmac('sha256', process.env.JWT_SECRET).update(`biz:${token.business_id}`).digest('hex').slice(0, 32);
    if (tokenHeader && tokenHeader !== expected) return res.status(403).send('forbidden');

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
      // Socket.IO 로 해당 워크스페이스에 변경 알림 (UI가 파일 리스트 재조회 트리거)
      const io = req.app.get('io');
      if (io && changes.length > 0) {
        io.to(`business:${token.business_id}`).emit('gdrive:changed', {
          count: changes.length,
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
