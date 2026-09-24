const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { FileFolder, File, Project, BusinessMember } = require('../models');
const { sequelize } = require('../config/database');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { getUserScope, canAccessProject, isMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

async function requireProjectInBusiness(projectId, businessId) {
  const project = await Project.findOne({ where: { id: projectId, business_id: businessId } });
  return !!project;
}

// member 이상 (쓰기 액션용)
async function assertMemberWrite(userId, businessId, platformRole) {
  if (platformRole === 'platform_admin') return true;
  const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
  return !!bm;
}

// ★ 2026-09-24 — 폴더 CUD 감사. 여태 이 파일에 `logAudit` 호출이 **0건**이었다(운영 원장 0행).
//   폴더에는 `deleted_at` 이 없어 지우면 행 자체가 사라지므로, 원장이 없으면 «그 폴더에 무엇이
//   있었나» 를 영영 답할 수 없다 — 실제로 2026-09-24 에 시각으로 역추적해야 했다.
//   실패해도 본 작업을 막지 않는다(감사 실패가 기능 실패가 되면 안 된다).
function logFolderAudit(req, action, folder, extra) {
  try {
    require('../services/auditService').logAudit(req, {
      action,
      targetType: 'file_folder',
      targetId: folder.id,
      ...(action === 'file_folder.create'
        ? { newValue: { name: folder.name, parent_id: folder.parent_id, project_id: folder.project_id, ...extra } }
        : { oldValue: extra?.old, newValue: extra?.next }),
    });
  } catch (e) { console.warn('[file_folders] audit 실패', action, e.message); }
}

// List folders of a project — client 도 자기 참여 프로젝트면 통과
router.get('/projects/:projectId', authenticateToken, async (req, res, next) => {
  try {
    const project = await Project.findByPk(req.params.projectId);
    if (!project) return errorResponse(res, 'Project not found', 404);
    const scope = await getUserScope(req.user.id, project.business_id, req.user.platform_role);
    if (!(await canAccessProject(req.user.id, project, scope))) {
      return errorResponse(res, 'forbidden', 403);
    }
    req.params.businessId = project.business_id;
    const folders = await FileFolder.findAll({
      where: { business_id: project.business_id, project_id: project.id },
      order: [['parent_id', 'ASC'], ['sort_order', 'ASC'], ['created_at', 'ASC']]
    });
    successResponse(res, folders);
  } catch (error) {
    next(error);
  }
});

// ─── 워크스페이스 폴더 (프로젝트에 속하지 않는 파일) ──────────────────────
//   Irene 2026-08-31: "우리 q 파일 리스트에 폴더 기능 넣고"
//   여태 폴더 라우트가 **전부 /projects/:projectId** 라, 프로젝트 없는 파일(운영 파일의 95%)은
//   폴더를 만들 길이 아예 없었다. 파일 쪽 배관은 이미 준비돼 있다 —
//   files.js 의 verifyFolderOwnership 은 projectId 가 없으면 business_id 만 본다.
//   ★ 권한·정렬 규칙은 프로젝트 폴더와 **같은 것**을 쓴다(두 벌로 갈라지지 않게).
router.get('/workspace/:businessId', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    if (!(scope.isMember || scope.isOwner || scope.isAdmin || scope.isPlatformAdmin)) {
      return errorResponse(res, 'forbidden', 403);
    }
    // ★ 2026-09-20 (Irene #417: *"프로젝트>파일에서 만든 폴더가 Q file 에 안 나온다"*) —
    //   **프로젝트 폴더와 그 하위 폴더까지** 같이 준다.
    //   Q file 의 파일 목록(`GET /api/files/:businessId`)은 `project_id` 로 거르지 **않는다** —
    //   즉 프로젝트 파일은 이미 이 화면에 들어와 있었는데 **폴더만 빠져** 있었다.
    //   그래서 파일은 보이는데 그 파일이 든 폴더로는 갈 수 없었다(사용자에게는 "폴더가 사라졌다").
    //   parent_id 사슬은 그대로 오므로 하위 폴더도 같이 온다 — 트리는 화면이 조립한다.
    const folders = await FileFolder.findAll({
      where: { business_id: businessId },
      order: [['parent_id', 'ASC'], ['sort_order', 'ASC'], ['created_at', 'ASC']],
      include: [{ model: Project, attributes: ['id', 'name'], required: false }],
    });
    // 프로젝트 이름은 **폴더가 어느 프로젝트 것인지** 화면이 묶는 데 쓴다.
    //   이름을 화면이 따로 조회하면 목록이 프로젝트 수만큼 요청을 쏘고, 이름이 갈린다.
    successResponse(res, folders.map((f) => {
      const j = f.toJSON();
      j.project_name = j.Project ? j.Project.name : null;
      delete j.Project;
      return j;
    }));
  } catch (error) { next(error); }
});

router.post('/workspace/:businessId', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    if (!(await assertMemberWrite(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const name = (req.body.name || '').trim();
    if (!name) return errorResponse(res, 'name required', 400);
    const parentId = req.body.parent_id ? Number(req.body.parent_id) : null;
    if (parentId) {
      const parent = await FileFolder.findOne({
        where: { id: parentId, business_id: businessId, project_id: null },
      });
      if (!parent) return errorResponse(res, 'Invalid parent_id', 400);
    }
    // 같은 자리에 같은 이름 두 개는 만들지 않는다 — 목록에서 구별이 안 된다.
    const dup = await FileFolder.findOne({
      where: { business_id: businessId, project_id: null, parent_id: parentId, name },
    });
    if (dup) return successResponse(res, dup);

    const row = await FileFolder.create({
      business_id: businessId, project_id: null, parent_id: parentId,
      name, sort_order: 0, created_by: req.user.id,
    });
    logFolderAudit(req, 'file_folder.create', row);
    successResponse(res, row, 'Folder created', 201);
  } catch (error) { next(error); }
});

// Create folder
router.post('/projects/:projectId', authenticateToken, async (req, res, next) => {
  try {
    const project = await Project.findByPk(req.params.projectId);
    if (!project) return errorResponse(res, 'Project not found', 404);
    if (!(await assertMemberWrite(req.user.id, project.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const name = (req.body.name || '').trim();
    if (!name) return errorResponse(res, 'name required', 400);
    const parentId = req.body.parent_id ? Number(req.body.parent_id) : null;

    if (parentId) {
      const parent = await FileFolder.findOne({
        where: { id: parentId, business_id: project.business_id, project_id: project.id }
      });
      if (!parent) return errorResponse(res, 'Invalid parent_id', 400);
    }

    const folder = await FileFolder.create({
      business_id: project.business_id,
      project_id: project.id,
      parent_id: parentId,
      name,
      sort_order: Number(req.body.sort_order) || 0,
      created_by: req.user.id
    });
    logFolderAudit(req, 'file_folder.create', folder);
    successResponse(res, folder, 'Folder created', 201);
  } catch (error) {
    next(error);
  }
});

// Reorder folder (up/down within same parent)
router.put('/:id/reorder', authenticateToken, async (req, res, next) => {
  try {
    const folder = await FileFolder.findByPk(req.params.id);
    if (!folder) return errorResponse(res, 'Folder not found', 404);
    if (!(await assertMemberWrite(req.user.id, folder.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const direction = req.body.direction;
    if (direction !== 'up' && direction !== 'down') {
      return errorResponse(res, 'direction must be "up" or "down"', 400);
    }

    const siblings = await FileFolder.findAll({
      where: {
        business_id: folder.business_id,
        project_id: folder.project_id,
        parent_id: folder.parent_id
      },
      order: [['sort_order', 'ASC'], ['created_at', 'ASC']]
    });

    const idx = siblings.findIndex(s => s.id === folder.id);
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= siblings.length) {
      return errorResponse(res, 'already at boundary', 400);
    }

    // 인접 swap (전체 sort_order 재계산으로 안정화)
    const reordered = [...siblings];
    [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]];

    const t = await sequelize.transaction();
    try {
      for (let i = 0; i < reordered.length; i++) {
        if (reordered[i].sort_order !== i) {
          reordered[i].sort_order = i;
          await reordered[i].save({ transaction: t });
        }
      }
      await t.commit();
      successResponse(res, { siblings: reordered.map(r => ({ id: r.id, sort_order: r.sort_order })) }, 'Reordered');
    } catch (e) { await t.rollback(); throw e; }
  } catch (error) {
    next(error);
  }
});

// Rename folder
router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const folder = await FileFolder.findByPk(req.params.id);
    if (!folder) return errorResponse(res, 'Folder not found', 404);
    if (!(await assertMemberWrite(req.user.id, folder.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    // ★ 워크스페이스 폴더(project_id = null)는 프로젝트 검사 대상이 아니다.
    //   여태 이 줄이 무조건 돌아 `requireProjectInBusiness(null, ...)` 가 항상 실패했다 —
    //   폴더가 프로젝트에만 있던 시절에는 드러나지 않던 전제다(실측: 이름 변경 403).
    if (folder.project_id && !(await requireProjectInBusiness(folder.project_id, folder.business_id))) {
      return errorResponse(res, 'Access denied', 403);
    }
    const name = (req.body.name || '').trim();
    if (!name) return errorResponse(res, 'name required', 400);
    const prevName = folder.name;
    folder.name = name;
    await folder.save();
    logFolderAudit(req, 'file_folder.rename', folder, { old: { name: prevName }, next: { name } });
    // Drive 에도 같은 이름으로 (Irene 2026-08-31 — 한쪽만 정리되면 두 곳이 갈라진다).
    //   실패해도 이름 변경 자체는 되돌리지 않는다 — Drive 는 사본이고 PlanQ 가 정본이다.
    if (folder.gdrive_folder_id) {
      try {
        const gdrive = require('../services/gdrive');
        const token = await gdrive.getTokenForBusiness(folder.business_id);
        if (token) await gdrive.renameFile(await gdrive.getDriveClient(token), folder.gdrive_folder_id, name);
      } catch (e) { console.warn('[folder rename] Drive 반영 실패:', e.message); }
    }
    successResponse(res, folder, 'Folder renamed');
  } catch (error) {
    next(error);
  }
});

// Delete folder (재귀: 하위 폴더 삭제, 안 파일은 parent 또는 루트로 이동)
// DELETE /api/file-folders/:id?contents=move|delete
//
// ★ 2026-09-24 — **안의 파일을 어떻게 할지 사람이 고른다.**
//   여태는 말없이 `folder.parent_id` 로 옮겼다. 사용자에게는 «폴더를 지웠는데 사진이 엉뚱한 폴더에
//   나타난» 것으로 보인다(Irene: *"파일이 다른 폴더로 옮겨진다고 나오더니 옮겨졌어. 같이 삭제할건지
//   물어봐야지."*). 실제로 그 때문에 옛 사본 18장이 루트에 남아 있었고, 어느 폴더에 있었는지는
//   폴더 감사 로그가 없어 시각으로 역추적해야 했다(아래 감사 추가).
//
//   · `move`(기본) — 종전 동작. 파일은 부모 폴더로. **기본값을 바꾸지 않는다** —
//     옛 화면·앱 번들이 인자를 안 보내는데 기본이 삭제면 조용히 지워진다(fail-safe).
//   · `delete`   — 안의 파일도 **휴지통으로**. `routes/files.js` 의 `trashFile` 을 그대로 쓴다
//     (쿼터·Drive 사본 회수·색인 회수가 한 벌로 따라온다). 영구삭제가 아니라 복구 가능하다.
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    const folder = await FileFolder.findByPk(req.params.id);
    if (!folder) return errorResponse(res, 'Folder not found', 404);
    if (!(await assertMemberWrite(req.user.id, folder.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const mode = String(req.query.contents || 'move').toLowerCase();
    if (mode !== 'move' && mode !== 'delete') {
      return errorResponse(res, 'contents must be "move" or "delete"', 400);
    }

    const t = await sequelize.transaction();
    try {
      // 재귀 수집
      const allFolderIds = [folder.id];
      const queue = [folder.id];
      while (queue.length) {
        const pid = queue.shift();
        const children = await FileFolder.findAll({
          where: { parent_id: pid }, transaction: t
        });
        for (const c of children) {
          allFolderIds.push(c.id);
          queue.push(c.id);
        }
      }

      // 안의 파일 — 고른 대로 처리한다.
      // ★ `business_id` 를 **반드시** 건다. 폴더 id 사슬은 `parent_id` 로만 모았으므로, 어떤 이유로든
      //   남의 워크스페이스 폴더가 사슬에 섞이면 그쪽 파일까지 집는다 — 그리고 아래 `delete` 분기는
      //   그것을 **지운다.** 상위에서 `folder.business_id` 를 확인했다는 사실에 기대지 않는다
      //   (CLAUDE.md 멀티테넌트 격리: 모든 쿼리에 WHERE business_id).
      const inside = await File.findAll({
        where: { business_id: folder.business_id, folder_id: { [Op.in]: allFolderIds }, deleted_at: null },
        transaction: t,
      });
      const mirrorQueue = [];   // ★ 요청 스코프 — 전역이면 롤백 잔여가 다음 요청에서 터진다
      if (mode === 'delete') {
        const { trashFile } = require('./files');
        for (const f of inside) await trashFile(f, req, t, mirrorQueue);
      } else {
        // 종전 동작 — parent_id 로 이동 (null = 루트)
        await File.update(
          { folder_id: folder.parent_id },
          { where: { folder_id: { [Op.in]: allFolderIds } }, transaction: t }
        );
      }

      // ★ Drive 쪽 폴더 id 를 **먼저 챙겨 둔다** — destroy 뒤엔 읽을 수 없다 (2026-09-17, Fable 8차 ⑤).
      //   여태 PlanQ 폴더만 지우고 Drive 폴더는 그대로 남겼다(실측: 빈 폴더가 공유 폴더 안에 잔존).
      //   파인더에서 보면 **없앤 폴더가 계속 보인다** — 지운 것이 지워지지 않은 상태다.
      //   ★ 순서를 **PlanQ 삭제 순서와 같게** 맞춘다 — 자식 먼저, 루트 마지막
      //     (2026-09-17, Fable 10차 #6). 쿼리 결과 순서는 보장되지 않으므로 손으로 세운다.
      //     루트를 먼저 다루면 그 안에 하위 폴더가 남아 «비어 있지 않아» 영영 안 지워진다.
      const driveByFolder = new Map((await FileFolder.findAll({
        where: { id: { [Op.in]: allFolderIds } }, attributes: ['id', 'gdrive_folder_id'], transaction: t, raw: true,
      })).map((r) => [r.id, r.gdrive_folder_id]));
      const driveFolderIds = allFolderIds
        .slice().reverse()                       // 자식(뒤에 쌓인 것) → 루트
        .map((id) => driveByFolder.get(id))
        .filter(Boolean);
      // 옮겨 갈 Drive 부모 — PlanQ 가 파일을 `folder.parent_id` 로 옮기는 것과 **같은 목적지**.
      // 부모가 없으면(루트) 커밋 뒤 `Workspace Files` 로 해석한다.
      const parentDriveId = folder.parent_id
        ? (await FileFolder.findByPk(folder.parent_id, { attributes: ['gdrive_folder_id'], transaction: t, raw: true }) || {}).gdrive_folder_id || null
        : null;

      // 폴더 삭제 (자식 먼저 → 루트 마지막)
      for (let i = allFolderIds.length - 1; i >= 0; i--) {
        await FileFolder.destroy({ where: { id: allFolderIds[i] }, transaction: t });
      }

      await t.commit();

      // ★ 파일 사본 회수도 **커밋 뒤**다 (trashFile 계약 — routes/files.js 와 같은 순서).
      if (mirrorQueue.length) {
        try { await require('./files').flushMirrorRecalls(mirrorQueue); }
        catch (e) { console.warn('[file_folders] 파일 Drive 사본 회수 실패', e.message); }
      }

      // ★ 2026-09-24 — 폴더 CUD 감사. 여태 `logAudit` 호출이 **0건**이어서 폴더 생성·이동·삭제가
      //   원장에 한 줄도 남지 않았다(운영 실측 0행). 그래서 «지운 폴더에 어떤 파일이 있었나» 를
      //   물었을 때 답할 방법이 없었다 — `file_folders` 에는 `deleted_at` 도 없어 행 자체가 사라진다.
      //   지운 목록을 **여기서** 남긴다(CLAUDE.md: 모든 CUD 는 AuditLog).
      require('../services/auditService').logAudit(req, {
        action: 'file_folder.delete',
        targetType: 'file_folder',
        targetId: folder.id,
        oldValue: {
          name: folder.name, parent_id: folder.parent_id, project_id: folder.project_id,
          removed_folder_ids: allFolderIds,
          contents: mode,
          files: inside.map((f) => ({ id: f.id, name: f.file_name })),
        },
      });

      // ★ Drive 호출은 **커밋 뒤**에 — 되돌릴 수 없는 외부 호출을 트랜잭션 안에 두지 않는다(⑦과 같은 이유).
      //   파일은 위에서 부모 폴더로 이미 옮겼으므로 여기서 지우는 것은 **빈 폴더**다.
      //   실패해도 삭제 자체는 되돌리지 않는다(PlanQ 가 정본이고, 빈 폴더는 다음 정리에서 걷힌다).
      if (driveFolderIds.length) {
        try {
          const gdrive = require('../services/gdrive');
          const token = await gdrive.getTokenForBusiness(folder.business_id);
          if (token) {
            const drive = await gdrive.getDriveClient(token);
            // ★ 규칙(자식먼저 · 먼저 옮기고 · 비었을 때만 삭제)은 `services/driveFolderCleanup`
            //   **한 곳**이다 (2026-09-17, Fable 10차 #5·#6). 라우트 안에 두면 회귀 검사가
            //   소스 문자열밖에 못 재고, 그런 검사는 `continue` 한 줄만 지워도 초록이다.
            let destId = parentDriveId;
            if (!destId) {
              try { destId = await require('../services/gdriveMirror').findWorkspaceFilesFolder(drive, token); }
              catch { destId = null; }
            }
            const r = await require('../services/driveFolderCleanup')
              .cleanupDriveFolders(drive, gdrive, driveFolderIds, destId);
            if (r.kept.length) console.warn('[file_folders] Drive 폴더에 항목이 남아 삭제하지 않음', r.kept.join(','));
          }
        } catch (e) { console.warn('[file_folders] Drive 정리 건너뜀', e.message); }
      }
      successResponse(res, {
        removed_folders: allFolderIds.length,
        contents: mode,
        // 화면이 «몇 장이 어디로 갔는지» 말할 수 있게 — 숫자가 없으면 결과를 설명할 수 없다.
        files_affected: inside.length,
      }, 'Folder deleted');
    } catch (e) { await t.rollback(); throw e; }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
