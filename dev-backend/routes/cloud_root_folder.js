// routes/cloud_root_folder.js — Google Drive 저장 위치(루트 폴더) 지정
//
// routes/cloud.js 에서 떼어냈다(2026-09-07). 그 파일이 515줄이 되어 라우트 500줄 기준을 넘겼고,
// 이 라우트는 주제가 하나라 통째로 옮기기 좋다. 마운트는 cloud.js 가 그대로 한다 — 경로 무변경.
const express = require('express');
const router = express.Router();
const { BusinessCloudToken, Business } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const gdrive = require('../services/gdrive');

// cloud.js 의 같은 이름 가드와 **같은 술어**여야 한다.
function requireOwnerForCloud(req, res, next) {
  if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
    return errorResponse(res, '클라우드 연동은 워크스페이스 오너만 가능합니다', 403);
  }
  next();
}

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

      // ②-0 그 안에 **이미 우리가 만든 폴더**가 있으면 그것을 쓴다.
      //   Irene: "내가 PlanQ 폴더 만들면 그 안에 PlanQ 폴더를 너가 또 만들어 넣을까봐 걱정인건데."
      //   맞는 걱정이다 — 표식으로 먼저 찾아서 **다시 만들지 않는다.**
      //   ★ 사용자의 폴더 자체를 루트로 쓸 수는 없다(실측: 우리가 만들지 않은 폴더는 읽지 못한다.
      //     읽지 못하면 낡음 판정도 못 하고 자가복구가 폭주한다). 그래서 그 **안에** 우리 폴더 하나를 둔다.
      if (!newRoot) {
        try {
          const mine = await drive.files.list({
            q: `'${targetId}' in parents and mimeType='application/vnd.google-apps.folder' `
              + `and appProperties has { key='planqBusinessId' and value='${String(businessId)}' } and trashed=false`,
            fields: 'files(id, name, createdTime)', orderBy: 'createdTime', pageSize: 1,
            supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: 'allDrives',
          });
          const found = (mine.data.files || [])[0];
          if (found) { newRoot = found.id; how = 'reused'; }
        } catch (e) {
          console.warn('[gdrive] 기존 PlanQ 폴더 검색 실패:', e.message);
        }
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

module.exports = router;
