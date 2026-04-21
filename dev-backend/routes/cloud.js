// 외부 클라우드 (Google Drive / Dropbox) OAuth + 연동 관리 라우트
const express = require('express');
const router = express.Router();
const { BusinessCloudToken, Business, User } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const gdrive = require('../services/gdrive');

// ─── 구성 상태 ───
router.get('/providers', authenticateToken, async (req, res, next) => {
  try {
    successResponse(res, {
      gdrive: { configured: gdrive.isConfigured() },
      dropbox: { configured: false }  // Phase 2C 에서
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

// ─── Google Drive OAuth 시작 ───
router.post('/connect/gdrive/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
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
  const closeWindowHtml = (title, body) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#F8FAFC;color:#0F172A;}
    .box{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:28px 32px;max-width:420px;text-align:center;box-shadow:0 4px 12px rgba(15,23,42,0.06);}
    h2{margin:0 0 8px;font-size:18px;color:#0F766E;}.err h2{color:#DC2626;}
    p{margin:0 0 16px;font-size:13px;color:#475569;line-height:1.5;}
    button{height:34px;padding:0 16px;background:#14B8A6;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;}
    button:hover{background:#0D9488;}</style></head>
    <body><div class="box ${title.includes('실패') ? 'err' : ''}">${body}<button onclick="window.close()">닫기</button></div>
    <script>setTimeout(() => { try { window.opener && window.opener.postMessage({ type: 'gdrive:connected', ok: ${!title.includes('실패')} }, '*'); } catch(e){} }, 300);</script>
    </body></html>`;

  if (oauthError) {
    return res.status(400).send(closeWindowHtml('연동 실패', `<h2>연동 실패</h2><p>Google 에서 거부됨: ${oauthError}</p>`));
  }
  if (!code || !state) {
    return res.status(400).send(closeWindowHtml('연동 실패', '<h2>연동 실패</h2><p>잘못된 요청</p>'));
  }

  const parsed = gdrive.parseState(state);
  if (!parsed) return res.status(400).send(closeWindowHtml('연동 실패', '<h2>연동 실패</h2><p>state 검증 실패</p>'));

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

    // 루트 폴더 생성 (없으면)
    if (!record.root_folder_id) {
      const biz = await Business.findByPk(parsed.businessId);
      const drive = await gdrive.getDriveClient(record);
      const root = await gdrive.createRootFolder(drive, biz ? biz.name : 'workspace');
      record.root_folder_id = root.id;
    }
    await record.save();

    return res.send(closeWindowHtml('연동 완료', `<h2>Google Drive 연동 완료</h2><p>계정: <strong>${accountEmail || '(확인 불가)'}</strong><br/>루트 폴더 생성됨.</p>`));
  } catch (e) {
    console.error('[gdrive callback]', e);
    return res.status(500).send(closeWindowHtml('연동 실패', `<h2>연동 실패</h2><p>${e.message || '서버 오류'}</p>`));
  }
});

// ─── 연동 해제 ───
router.delete('/disconnect/:provider/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { provider, bizId } = req.params;
    if (!['gdrive', 'dropbox'].includes(provider)) return errorResponse(res, 'unknown provider', 400);
    await BusinessCloudToken.destroy({ where: { business_id: bizId, provider } });
    // 주의: 외부 클라우드의 실제 파일은 그대로 남음 (의도된 동작)
    successResponse(res, null, 'Disconnected');
  } catch (error) { next(error); }
});

module.exports = router;
