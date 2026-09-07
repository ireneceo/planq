// routes/personal_drive.js — 개인 Google Drive: 목록 + 가져오기
//
// external_connections.js 에서 떼어냈다(2026-09-07). 그 파일이 539줄이 되어
// 라우트 파일 500줄 기준을 넘겼고, 이 두 라우트는 주제가 하나로 묶여 있어 통째로 옮기기 좋다.
// 마운트는 external_connections 가 그대로 한다 — **경로는 하나도 안 바뀐다**.
//
// ★ drive.file scope — PlanQ 가 만들었거나 사용자가 PlanQ 로 연 파일만 보인다.
//   전체 열람(drive.readonly)은 제한 권한·유료 심사라 채택 안 함(Irene 결정 2026-06-01).
const express = require('express');
const router = express.Router();
const { BusinessMember, ExternalConnection } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserDaily } = require('../middleware/costGuard');
const personalOauth = require('../services/personalOauth');
const personalDrive = require('../services/personalDrive');
const { importDriveFile } = require('../services/driveImport');

// external_connections 의 같은 이름 헬퍼와 **같은 술어**여야 한다.
//   (여기서 느슨해지면 목록은 막히는데 가져오기는 열리는 식으로 갈라진다.)
async function assertBusinessMember(req, bizId) {
  if (req.user.platform_role === 'platform_admin') return true;
  const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: bizId, removed_at: null } });
  return !!bm;
}

// ─── Phase 4 — 개인 Google Drive 파일 목록 (읽기 전용) ──────
// GET /api/me/drive/files?business_id=&q=&page_token=
router.get('/me/drive/files', authenticateToken, async (req, res, next) => {
  try {
    const bizId = parseInt(req.query.business_id, 10);
    if (!bizId) return errorResponse(res, 'business_id_required', 400);
    if (!(await assertBusinessMember(req, bizId))) return errorResponse(res, 'no_business_access', 403);

    const conn = await ExternalConnection.findOne({
      where: {
        owner_scope: 'user', user_id: req.user.id, business_id: bizId,
        provider: 'google_drive', is_active: true,
      },
    });
    if (!conn) return successResponse(res, { connected: false, files: [], next_page_token: null });

    try {
      const out = await personalDrive.listFiles(conn, { q: req.query.q, pageToken: req.query.page_token });
      await conn.update({ last_sync_at: new Date(), last_sync_error: null, fail_count: 0 });
      return successResponse(res, { connected: true, account_email: conn.account_email, ...out });
    } catch (e) {
      console.error('[me/drive/files] fetch failed conn=' + conn.id, e.message);
      await conn.update({ last_sync_error: e.message, fail_count: (conn.fail_count || 0) + 1 }).catch(() => {});
      return errorResponse(res, `drive_fetch_failed: ${e.message}`, 502);
    }
  } catch (err) { next(err); }
});

// ─── 개인 Google Drive 에서 골라 PlanQ 로 가져오기 (노션식 첨부) ──────
// POST /api/me/drive/import  { business_id, file_id, project_id?, folder_id? }
//
// Irene: "파일첨부할 때 구글드라이브에서 가져와서 첨부하게 노션처럼도 기능 추가해 달라고 했는데"
//
// 목록(GET /me/drive/files)만 있고 **가져오는 문이 없어서** 원본을 새 탭에서 여는 것이 전부였다.
// 바이트를 우리가 쥐어야 미리보기·공유·보존이 되므로, 워크스페이스 미러와 **같은 함수**로 들인다
// (쿼터·dedup·감사·브로드캐스트가 한쪽에만 남지 않게 — services/driveImport).
//
// ★ 외부 API 를 부르고 저장공간을 쓰는 라우트다 — per-user rate-limit 필수(운영 안정성 규칙 1).
router.post('/me/drive/import', authenticateToken,
  ...perUserDaily('drive-import', { perMin: 20, perDay: 500 }),
  async (req, res, next) => {
    try {
      const bizId = parseInt(req.body.business_id, 10);
      const fileId = String(req.body.file_id || '').trim();
      if (!bizId) return errorResponse(res, 'business_id_required', 400);
      if (!fileId) return errorResponse(res, 'file_id_required', 400);
      if (!(await assertBusinessMember(req, bizId))) return errorResponse(res, 'no_business_access', 403);

      const conn = await ExternalConnection.findOne({
        where: {
          owner_scope: 'user', user_id: req.user.id, business_id: bizId,
          provider: 'google_drive', is_active: true,
        },
      });
      if (!conn) return errorResponse(res, 'drive_not_connected', 400);

      const projectId = req.body.project_id ? Number(req.body.project_id) : null;
      const folderId = req.body.folder_id ? Number(req.body.folder_id) : null;

      const { google } = require('googleapis');
      const auth = await personalOauth.getAuthedClient(conn);
      const drive = google.drive({ version: 'v3', auth });

      // 메타를 먼저 받아 확장자·크기·네이티브 여부를 **내려받기 전에** 판정한다.
      let meta;
      try {
        const r = await drive.files.get(
          { fileId, fields: 'id, name, mimeType, size, webViewLink, md5Checksum' },
          { timeout: 10000 });
        meta = r.data;
      } catch (e) {
        // 내 Drive 지만 drive.file scope 라 PlanQ 가 만들지 않은 파일은 404 로 온다.
        //   "권한이 없다" 가 아니라 "이 앱이 못 보는 파일" 이므로 그대로 말한다.
        return errorResponse(res, `drive_file_unavailable: ${String(e.message).slice(0, 120)}`, 404);
      }

      const r = await importDriveFile(
        { drive, businessId: bizId, uploaderId: req.user.id },
        meta,
        { folderId, projectId, visibility: projectId ? 'L2' : 'L3', actor: 'user' },
      );
      if (!r.ok) {
        // 왜 안 되는지 화면이 말할 수 있게 사유를 그대로 돌려준다(조용한 실패 금지).
        const status = r.reason === 'storage_quota_exceeded' || r.reason === 'file_size_exceeded' ? 413
          : r.reason === 'extension_not_allowed' || r.reason === 'google_native' ? 415
            : 502;
        return errorResponse(res, r.reason, status);
      }
      return successResponse(res, {
        file_id: r.file.id,
        composite_id: `direct-${r.file.id}`,
        file_name: r.file.file_name,
        file_size: r.file.file_size,
        mime_type: r.file.mime_type,
        already: r.reason === 'already_ingested',
      });
    } catch (err) { next(err); }
  });

module.exports = router;
