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

// ─── 파인더 공유 — PlanQ 폴더를 팀원 구글 계정에 열어 준다 (2026-09-17) ─────────────
//
// Irene #419: *"구글드라이브 연동된 거 실제 해당 구글드라이브로 로그인한 사람만 파인더에서 볼 수
//   있잖아. 플랜큐앱 폴더를. 고객이나 내부멤버들이 연결을 원하면 어떻게 해?
//   공유를 요청하고 해주고 하는게 플랜큐에서 가능할까?"*
//
// **가능하다.** `drive.file` scope 로도 **앱이 만든 폴더**의 권한은 관리할 수 있다
//   (services/gdrive.grantFileAccess — 2026-09-07 에 개별 파일용으로 이미 만들어 뒀다).
//   루트 폴더는 우리가 만든 것이므로 같은 함수가 그대로 먹는다. 구글 심사(restricted scope)는
//   **역방향 인제스트**에만 필요하고 공유에는 필요 없다.
//
// ★★ 여는 것은 **루트가 아니라 `Workspace Files` 폴더 하나**다 (2026-09-17, Fable 게이트 FAIL).
//   처음엔 `root_folder_id` 에 권한을 줬는데 그 루트 **아래**에는 PlanQ 안에서 각자 게이트가 걸린
//   것들이 함께 있다 — 멤버 한 명에게 루트를 열면 **네 게이트를 Drive 로 통째로 우회한다**:
//     ① `root/Q Note/<세션>`     — 사적 공간. owner 도 admin 도 백도어가 없다(CLAUDE.md §Q Note)
//     ② `root/Conversations`     — 고객 대화방 첨부. PlanQ 에선 **참여자만** 본다
//     ③ `root/<프로젝트>`        — L2 프로젝트 파일. 비멤버는 PlanQ 에서 못 본다
//     ④ 나중에 대외비로 바꾼 파일 — `PUT /security-level` 에 **Drive 회수 코드가 없다**(별도 결함)
//   "보안등급 파일은 미러에서 빠지니 폴더에 없다" 는 **미러 경로만** 맞다. 프로젝트·대화 첨부는
//   미러가 아니라 **직접 Drive 저장**이라 `security_level` 을 보지 않는다.
//   → 공유 대상은 `gdriveMirror.ensureWorkspaceFilesFolder` 가 만드는 그 폴더로 **한정**한다.
//     거기 들어가는 것은 미러 대상뿐이고, 미러는 `isEligible` 에서 대외비·L1 을 이미 거른다.
//   ★ Drive 권한은 **비가역**이다 — 한 번 주면 우리 롤백으로 회수되지 않는다. 좁은 쪽이 기본이다.
// ★ 기본은 **reader**(보기). 쓰기는 호출측이 명시할 때만 — 파인더에서 보이게 하는 것이 요청이었고,
//   고치게 하는 것은 별개의 허락이다.
// ★ 고객(client)에게는 폴더를 열지 않는다. 폴더 공유는 그 안의 **모든 것**을 여는 것이라
//   범위를 고를 수 없다 — 고객에게는 파일 단위 공개 링크가 맞는 문이다(이미 있다).
// ★ 알림 메일을 보내지 않는다(grantFileAccess 계약). 외부 발송은 우리가 확인을 받고 하는 일이다.
// ★ 구글 계정이 없는 주소에는 줄 수 없다 — 그 사유를 **그대로 돌려준다**(화면이 사람 말로 설명한다).
//   `drive_error:` 로 뭉뚱그리면 사용자에게는 "안 된다" 로만 보인다.
// ★ 외부 quota·비용 라우트는 **per-user rate-limit** 이 규약이다(CLAUDE.md 운영 안정성 1).
//   Drive `permissions.create` 는 외부 호출이고 **되돌릴 수 없다** — 실수로 반복 호출되면
//   그만큼 권한이 나간다. owner 전용이라 위험은 낮지만 규약에 예외를 두지 않는다.
const shareRootLimiter = require('../middleware/costGuard')
  .perUserLimiter('gdrive-share-root', { windowMs: 60 * 1000, max: 6 });

router.post('/gdrive/:businessId/share-root', authenticateToken, checkBusinessAccess, requireOwnerForCloud,
  shareRootLimiter,
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const token = await gdrive.getTokenForBusiness(businessId);
      if (!token || !token.root_folder_id) return errorResponse(res, 'not_connected', 400);

      const { BusinessMember, User } = require('../models');
      // ★ 입력 배열에 상한을 둔다 — 안 두면 한 번의 요청이 Drive API 를 무제한으로 태운다
      //   (외부 quota·비용 라우트의 기본. CLAUDE.md 운영 안정성 1).
      const MAX_TARGETS = 50;
      const userIds = [...new Set((Array.isArray(req.body?.user_ids) ? req.body.user_ids : [])
        .map(Number).filter(Boolean))].slice(0, MAX_TARGETS);
      if (!userIds.length) return errorResponse(res, 'no_targets', 400);

      // ★ 대상은 **이 워크스페이스 멤버**여야 한다. 넘어온 id 를 믿지 않는다(멀티테넌트 격리).
      const members = await BusinessMember.findAll({
        where: { business_id: businessId, user_id: userIds },
        include: [{ model: User, as: 'user', attributes: ['id', 'email', 'name'] }],
        limit: MAX_TARGETS,
      });
      if (!members.length) return errorResponse(res, 'no_members', 400);

      // 기본은 보기 권한. 쓰기는 **명시할 때만** (위 머리말).
      const role = req.body?.role === 'writer' ? 'writer' : 'reader';
      const drive = await gdrive.getDriveClient(token);
      // ★ 루트가 아니라 **Workspace Files 폴더**를 연다. 없으면 만든다(미러와 같은 함수 = 같은 폴더).
      const shareFolderId = await require('../services/gdriveMirror')
        .ensureWorkspaceFilesFolder(drive, token);
      const results = [];
      for (const m of members) {
        const email = m.user?.email || null;
        const r = await gdrive.grantFileAccess(drive, shareFolderId, email, role);
        results.push({ user_id: m.user_id, email, name: m.user?.name || null, ...r });
      }

      require('../services/auditService').logAudit(req, {
        action: 'cloud.gdrive_folder_shared', targetType: 'business', targetId: businessId, businessId,
        newValue: { folder_id: shareFolderId, scope: 'workspace_files', role, targets: results.map((x) => x.user_id) },
      });

      return successResponse(res, {
        folder_id: shareFolderId,
        web_view_link: `https://drive.google.com/drive/folders/${shareFolderId}`,
        results,
      });
    } catch (err) { next(err); }
  });

// GET — 지금 누가 이 폴더를 볼 수 있는가. 화면이 «요청/해주기» 를 그리려면 현재 상태가 있어야 한다.
router.get('/gdrive/:businessId/share-root', authenticateToken, checkBusinessAccess, requireOwnerForCloud,
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const token = await gdrive.getTokenForBusiness(businessId);
      if (!token || !token.root_folder_id) return errorResponse(res, 'not_connected', 400);
      const drive = await gdrive.getDriveClient(token);
      // 쓰는 곳과 **같은 폴더**를 본다 — 둘이 갈라지면 "공유했는데 목록에 없다" 가 된다.
      const shareFolderId = await require('../services/gdriveMirror')
        .ensureWorkspaceFilesFolder(drive, token);
      let rootName = 'PlanQ';
      try {
        const biz = await Business.findByPk(businessId, { attributes: ['name'] });
        rootName = `PlanQ - ${(biz && biz.name) || 'workspace'}`;   // ensureRootFolder 와 같은 규칙
      } catch { /* 이름을 못 읽으면 기본값 */ }
      const list = await drive.permissions.list({
        fileId: shareFolderId,
        fields: 'permissions(id, emailAddress, role, type, displayName)',
        supportsAllDrives: true,
      });
      return successResponse(res, {
        folder_id: shareFolderId,
        web_view_link: `https://drive.google.com/drive/folders/${shareFolderId}`,
        // ★ **연결한 사람**을 같이 내려준다 (2026-09-17, Fable 6차 FAIL).
        //   그 사람은 이미 이 폴더의 주인이라 열어 줄 것이 없다. 그런데 화면이 그를 목록에 두면
        //   눌러서 **다른 구글 계정에 실제로 권한이 부여된다** — Drive owner 이메일과 PlanQ 계정
        //   이메일이 다를 수 있어(운영 실측: irene@irenewp.com vs irene@irenecompany.com)
        //   권한 목록 대조로는 걸러지지 않는다. 그리고 부여는 **되돌릴 수 없다.**
        //   이메일이 아니라 **누가 연결했는가(user id)** 로 가른다.
        connected_by: token.connected_by || null,
        // ★ **폴더 이름을 화면이 손으로 적지 않는다** (2026-09-17, Fable 8차 ⑧).
        //   확인창이 «PlanQ / Workspace Files» 라고 적어 뒀는데 실제 루트는
        //   `PlanQ - <워크스페이스 이름>` 이다(`ensureRootFolder`). 사용자가 파인더에서 찾을 때
        //   **그 이름이 없다.** 서버가 실제 경로를 내려주고 화면은 받아 쓴다.
        folder_path: `${rootName} / Workspace Files`,
        permissions: (list.data.permissions || []).map((p) => ({
          email: p.emailAddress || null, role: p.role, type: p.type, name: p.displayName || null,
        })),
      });
    } catch (err) { next(err); }
  });

// ─── 공유 해제 — 준 권한을 거둔다 (2026-09-17, Fable 8차 ⑭) ────────────────
//   확인창은 "PlanQ 에서 되돌릴 수 없다" 고 말하는데, **앱이 만든 폴더라 `permissions.delete` 는
//   기술적으로 가능**하다. 할 수 있는 것을 못 한다고 말하면 사용자는 구글까지 들어가야 한다.
//   ★ 다만 «되돌릴 수 없음» 이 아주 거짓은 아니다 — 그 사람이 이미 파일을 **자기 드라이브로 복사**했다면
//     그 사본은 회수되지 않는다. 그래서 화면 문구는 "접근을 끊는다" 이지 "없던 일로 만든다" 가 아니다.
router.delete('/gdrive/:businessId/share-root', authenticateToken, checkBusinessAccess, requireOwnerForCloud,
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const token = await gdrive.getTokenForBusiness(businessId);
      if (!token || !token.root_folder_id) return errorResponse(res, 'not_connected', 400);
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) return errorResponse(res, 'no_email', 400);

      const drive = await gdrive.getDriveClient(token);
      const shareFolderId = await require('../services/gdriveMirror').ensureWorkspaceFilesFolder(drive, token);
      const cur = await drive.permissions.list({
        fileId: shareFolderId, fields: 'permissions(id, emailAddress, role)', supportsAllDrives: true,
      });
      const mine = (cur.data.permissions || []).find(
        (p) => String(p.emailAddress || '').toLowerCase() === email,
      );
      if (!mine) return successResponse(res, { removed: false, reason: 'not_shared' });
      // 소유자 권한은 건드리지 않는다 — 지우면 폴더 자체를 잃는다.
      if (mine.role === 'owner') return errorResponse(res, 'cannot_remove_owner', 400);
      await drive.permissions.delete({ fileId: shareFolderId, permissionId: mine.id, supportsAllDrives: true });

      require('../services/auditService').logAudit(req, {
        action: 'cloud.gdrive_folder_unshared', targetType: 'business', targetId: businessId, businessId,
        oldValue: { email, role: mine.role }, newValue: { folder_id: shareFolderId },
      });
      return successResponse(res, { removed: true, email });
    } catch (err) { next(err); }
  });

module.exports = router;
