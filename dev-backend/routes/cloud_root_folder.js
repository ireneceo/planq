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

      // 주소창을 그대로 붙여넣는다 — "링크 복사" 메뉴가 아니다(팀 드라이브엔 그 메뉴가 없다).
      //   .../folders/<id> · open?id=<id> · 그냥 <id>
      const m = raw.match(/\/folders\/([A-Za-z0-9_-]{10,})/)
        || raw.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
        || raw.match(/^([A-Za-z0-9_-]{10,})$/);
      if (!m) return errorResponse(res, 'invalid_folder_location', 400);
      const targetId = m[1];

      const token = await BusinessCloudToken.findOne({
        where: { business_id: businessId, provider: 'gdrive' },
      });
      if (!token) return errorResponse(res, 'workspace_drive_not_connected', 400);
      const oldRoot = token.root_folder_id;
      if (targetId === oldRoot) return errorResponse(res, 'same_location', 400);

      const drive = await gdrive.getDriveClient(token);

      // ★ **지정한 폴더를 그대로 저장 폴더로 쓴다.** 그 안에 PlanQ 폴더를 또 만들지 않는다 —
      //   Irene 2026-09-07: "중요한 건 지정한 폴더에 추가로 폴더를 만들면 안된다는 거잖아."
      //   (직전 구현은 그 안에 폴더를 하나 더 만들어 매번 한 단계 더 들어가야 했다. 잘못된 구조다.)
      //   우리가 만들지 않은 폴더라 **읽히지는 않지만**, 그 안에 만들고 옮기는 것은 된다(실측).
      //   그래서 읽기 대신 **쓸 수 있는지**로 쓸 만한 자리인지 확인한다.
      if (!(await gdrive.canWriteInto(drive, targetId))) {
        return errorResponse(res, 'folder_unusable', 400);
      }

      // 기존 내용물을 새 자리로 옮긴다 — 폴더만 옮기면 그 안의 파일이 따라온다.
      //   ★ 옛 루트의 자식들은 **우리가 만든 것**이라 목록이 보인다.
      //   ★ 실패해도 위치 변경 자체는 진행한다 — 앞으로 올릴 파일이 새 자리로 가는 것이 우선이고,
      //     못 옮긴 것은 옛 자리에 그대로 남아 있다(사라지지 않는다). 몇 개를 옮겼는지 알려준다.
      let moved = 0;
      let movedAll = true;
      if (oldRoot) {
        try {
          const kids = await drive.files.list({
            q: `'${oldRoot}' in parents and trashed=false`,
            fields: 'files(id, name)', pageSize: 200,
            supportsAllDrives: true, includeItemsFromAllDrives: true,
          });
          for (const k of (kids.data.files || [])) {
            try {
              await drive.files.update({
                fileId: k.id, addParents: targetId, removeParents: oldRoot,
                fields: 'id', supportsAllDrives: true,
              });
              moved += 1;
            } catch (e) {
              movedAll = false;
              console.warn('[gdrive] 항목 이동 실패:', k.name, e.message);
            }
          }
        } catch (e) {
          movedAll = false;
          console.warn('[gdrive] 옛 저장 폴더 목록 조회 실패:', e.message);
        }
      }

      // 하위 폴더 캐시는 옛 루트 기준이라 비운다 — 안 비우면 새 자리에서 옛 폴더를 찾으려 든다.
      //   (옮겨진 폴더는 id 가 그대로라 실제로는 유효하지만, 못 옮긴 경우까지 생각하면 다시 만드는 편이 안전하다.)
      await token.update({
        root_folder_id: targetId,
        workspace_folder_id: null,
        conversations_folder_id: null,
        qnote_folder_id: null,
        last_error: null,
      });
      require('../services/auditService').logAudit(req, {
        action: 'cloud.gdrive_root_changed', targetType: 'business', targetId: businessId,
        businessId,
        oldValue: { root_folder_id: oldRoot },
        newValue: { root_folder_id: targetId, moved, moved_all: movedAll },
      });

      return successResponse(res, {
        folder: {
          id: targetId,
          // 우리가 만든 폴더가 아니라 이름을 읽을 수 없다 — 화면은 링크로 확인시킨다.
          web_view_link: `https://drive.google.com/drive/folders/${targetId}`,
        },
        moved,
        moved_all: movedAll,
      });
    } catch (err) { next(err); }
  });

module.exports = router;
