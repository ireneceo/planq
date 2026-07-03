const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { Task, TaskAttachment, TaskComment, User, BusinessMember, BusinessCloudToken, Project, File } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { getUserScope, canAccessTask, isMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { applyMemberDisplayName } = require('../services/displayName');
const gdrive = require('../services/gdrive');
const { decodeOriginalName, buildContentDisposition } = require('../services/filename');
const { perUserLimiter } = require('../middleware/costGuard');

// 비용폭탄 H4 — 업무 첨부 업로드 per-user rate-limit (분당 10회, 라우트 내부 적용).
const taskAttachUploadLimiter = perUserLimiter('task-attach', { windowMs: 60 * 1000, max: 10, message: '파일 업로드가 너무 잦습니다. 잠시 후 다시 시도하세요.' });

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const ALLOWED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.txt', '.md', '.csv',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const ym = new Date().toISOString().slice(0, 7); // 2026-04
    const biz = req._task?.business_id || 'misc';
    const dir = path.join(UPLOAD_ROOT, String(biz), ym);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB (요금제별 제한은 상위 검사)
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error('disallowed_extension'));
    cb(null, true);
  },
});

async function loadTaskAndGuard(req, res) {
  const task = await Task.findByPk(req.params.taskId);
  if (!task) { errorResponse(res, 'task_not_found', 404); return null; }
  const scope = await getUserScope(req.user.id, task.business_id, req.user.platform_role);
  if (!(await canAccessTask(req.user.id, task, scope))) {
    errorResponse(res, 'forbidden', 403); return null;
  }
  req._task = task;
  req._scope = scope;
  return task;
}

// description 첨부 권한 = description 편집 권한 (사이클 N+5 책임선)
//   = 작성자(created_by) / owner / admin. 담당자 빠짐 (의뢰자 영역).
async function canEditDescriptionAttach(task, userId, platformRole) {
  if (platformRole === 'platform_admin') return true;
  if (task.created_by === userId) return true;
  const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: task.business_id } });
  if (bm && bm.role === 'owner') return true;
  return false;
}

// ============================================
// POST /api/tasks/:taskId/attachments — 업로드 (task/description/comment 공통)
// Query: ?context=task|description|comment  ?commentId=...
// ============================================
router.post('/:taskId/attachments',
  authenticateToken,
  taskAttachUploadLimiter,
  async (req, res, next) => {
    try { if (!(await loadTaskAndGuard(req, res))) return; next(); }
    catch (err) { next(err); }
  },
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.message === 'disallowed_extension') return errorResponse(res, 'disallowed_extension', 400);
      if (err.code === 'LIMIT_FILE_SIZE') return errorResponse(res, 'file_too_large', 400);
      return errorResponse(res, err.message || 'upload_failed', 400);
    });
  },
  async (req, res, next) => {
    try {
      if (!req.file) return errorResponse(res, 'file_required', 400);
      const context = ['description', 'description_attach', 'comment'].includes(req.query.context) ? req.query.context : 'task';
      const commentId = context === 'comment' ? Number(req.query.commentId || 0) || null : null;
      if (context === 'comment' && !commentId) return errorResponse(res, 'commentId_required', 400);
      // description_attach: 의뢰자 영역 = 작성자/owner/admin 만 (담당자 빠짐)
      if (context === 'description_attach') {
        const ok = await canEditDescriptionAttach(req._task, req.user.id, req.user.platform_role);
        if (!ok) {
          // 업로드된 임시 파일 정리
          try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
          return errorResponse(res, 'only_creator_or_owner_can_attach_description', 403);
        }
      }

      // 비용폭탄 재게이트(2026-07-03) — 자체(planq) 저장분은 플랜 크기한도 + 총 쿼터를 강제.
      //   Drive 로 라우팅될 파일은 external(5GB 단일 상한)만. 단, Drive 업로드가 실패해 로컬로
      //   폴백하면 반드시 planq 기준으로 재검증한다(폴백분이 크기·쿼터를 우회하던 구멍 차단).
      const planEngine = require('../services/plan');
      const { reservePlanqUpload, releasePlanqUpload } = require('../services/storageUsage');
      const attachCloud = await BusinessCloudToken.findOne({ where: { business_id: req._task.business_id, provider: 'gdrive' } });
      const willUseDrive = !!(attachCloud && attachCloud.root_folder_id && req._task.project_id);
      {
        const canUp = await planEngine.can(req._task.business_id, 'upload_file', { size: req.file.size, external: willUseDrive });
        if (!canUp.ok) {
          try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
          if (canUp.reason === 'file_size_exceeded') {
            const limitMB = Math.round((canUp.limit || 0) / 1024 / 1024);
            return errorResponse(res, `파일이 너무 큽니다. 현재 플랜에서 ${limitMB}MB 까지 가능 — 큰 파일은 Google Drive 를 연결해 주세요.`, 413);
          }
          return errorResponse(res, '워크스페이스 저장 용량을 초과했어요. 파일을 정리하거나 플랜을 올려주세요.', 413);
        }
      }

      // Drive 연동 + 프로젝트 소속 task 면 Drive 로 업로드
      let storageProvider = 'planq';
      let externalId = null;
      let externalUrl = null;
      let finalFilePath = path.relative(path.join(__dirname, '..'), req.file.path).replace(/\\/g, '/');
      let finalStoredName = path.basename(req.file.path);

      if (willUseDrive) {
        try {
          const project = await Project.findByPk(req._task.project_id);
          if (project) {
            const drive = await gdrive.getDriveClient(attachCloud);
            const projectFolderId = await gdrive.ensureProjectFolder(drive, attachCloud, project);
            const driveFile = await gdrive.uploadFile(drive, {
              name: decodeOriginalName(req.file.originalname), mimeType: req.file.mimetype,
              body: fs.createReadStream(req.file.path), parentId: projectFolderId
            });
            storageProvider = 'gdrive';
            externalId = driveFile.id;
            externalUrl = driveFile.webViewLink;
            finalFilePath = driveFile.id;
            finalStoredName = driveFile.id;
            fs.unlinkSync(req.file.path);
            gdrive.clearTokenError(attachCloud);
          }
        } catch (e) {
          console.error('[task_attachments] external upload failed:', e.message);
          gdrive.recordTokenError(attachCloud, e);
          // 실패 시 로컬 유지 — 아래에서 planq 기준으로 재검증.
        }
      }

      // 자체 저장(planq)으로 확정된 경우(비-Drive 이거나 Drive 폴백) — 크기 재검증 + race-safe 쿼터 예약.
      if (storageProvider === 'planq') {
        if (willUseDrive) {
          // 위 early check 는 external:true(5GB 상한)로 통과 → 플랜 파일크기 한도가 미검증 상태.
          //   Drive 폴백분은 로컬에 남으므로 planq 기준으로 다시 막는다(finding 3).
          const localCheck = await planEngine.can(req._task.business_id, 'upload_file', { size: req.file.size, external: false });
          if (!localCheck.ok) {
            try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
            if (localCheck.reason === 'file_size_exceeded') {
              const limitMB = Math.round((localCheck.limit || 0) / 1024 / 1024);
              return errorResponse(res, `파일이 너무 큽니다. 현재 플랜에서 ${limitMB}MB 까지 가능해요 (Google Drive 업로드 실패로 로컬 저장).`, 413);
            }
            return errorResponse(res, '워크스페이스 저장 용량을 초과했어요. 파일을 정리하거나 플랜을 올려주세요.', 413);
          }
        }
        let reserved;
        try {
          reserved = await reservePlanqUpload(req._task.business_id, req.file.size);
        } catch (e) {
          // 예약 자체가 실패(락 경합 재시도 소진 등) → 임시파일 정리 후 재던짐(집계 오염 없음).
          try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
          throw e;
        }
        if (!reserved.ok) {
          try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
          return errorResponse(res, '워크스페이스 저장 용량을 초과했어요. 파일을 정리하거나 플랜을 올려주세요.', 413);
        }
      }

      let att;
      try {
        att = await TaskAttachment.create({
          business_id: req._task.business_id,
          task_id: req._task.id,
          comment_id: commentId,
          context,
          original_name: decodeOriginalName(req.file.originalname),
          stored_name: finalStoredName,
          file_path: finalFilePath,
          file_size: req.file.size,
          mime_type: req.file.mimetype,
          uploaded_by: req.user.id,
          storage_provider: storageProvider,
          external_id: externalId,
          external_url: externalUrl,
        });
      } catch (e) {
        // 레코드 생성 실패 → planq 예약분 반환(집계 정합). Drive 저장분은 외부라 반환 대상 아님.
        if (storageProvider === 'planq') {
          await releasePlanqUpload(req._task.business_id, req.file.size).catch(() => {});
          try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        }
        throw e;
      }

      return successResponse(res, {
        id: att.id,
        context: att.context,
        original_name: att.original_name,
        stored_name: att.stored_name,
        file_size: att.file_size,
        mime_type: att.mime_type,
        download_url: `/api/tasks/attachments/${att.id}/download`,
        preview_url: att.mime_type?.startsWith('image/') ? `/api/tasks/public/attach/${att.stored_name}` : null,
        created_at: att.created_at,
      });
    } catch (err) {
      if (err.message === 'disallowed_extension') return errorResponse(res, 'disallowed_extension', 400);
      next(err);
    }
  }
);

// ============================================
// POST /api/tasks/:taskId/attachments/link — 기존 Q file 파일을 task 첨부로 참조
// body: { file_ids: number[], context?: 'task'|'comment', comment_id? }
// 메타만 복사해 TaskAttachment 생성, 물리 파일은 원본 Files 레코드와 공유.
// ============================================
router.post('/:taskId/attachments/link', authenticateToken, async (req, res, next) => {
  try {
    if (!(await loadTaskAndGuard(req, res))) return;
    const fileIds = Array.isArray(req.body?.file_ids) ? req.body.file_ids.map(Number).filter(Boolean) : [];
    if (fileIds.length === 0) return errorResponse(res, 'file_ids required', 400);
    const context = ['comment', 'description_attach'].includes(req.body?.context) ? req.body.context : 'task';
    const commentId = context === 'comment' ? Number(req.body?.comment_id || 0) || null : null;
    if (context === 'comment' && !commentId) return errorResponse(res, 'comment_id required', 400);
    if (context === 'description_attach') {
      const ok = await canEditDescriptionAttach(req._task, req.user.id, req.user.platform_role);
      if (!ok) return errorResponse(res, 'only_creator_or_owner_can_attach_description', 403);
    }

    const files = await File.findAll({
      where: { id: fileIds, business_id: req._task.business_id, deleted_at: null }
    });
    const created = [];
    for (const f of files) {
      const att = await TaskAttachment.create({
        business_id: req._task.business_id,
        task_id: req._task.id,
        comment_id: commentId,
        context,
        original_name: f.file_name,
        stored_name: f.file_path.split('/').pop() || f.file_name,
        file_path: f.file_path,
        file_size: f.file_size,
        mime_type: f.mime_type,
        uploaded_by: req.user.id,
        storage_provider: f.storage_provider,
        external_id: f.external_id,
        external_url: f.external_url,
      });
      created.push({
        id: att.id,
        context: att.context,
        original_name: att.original_name,
        stored_name: att.stored_name,
        file_size: att.file_size,
        mime_type: att.mime_type,
        download_url: `/api/tasks/attachments/${att.id}/download`,
        preview_url: att.mime_type?.startsWith('image/') ? `/api/tasks/public/attach/${att.stored_name}` : null,
        created_at: att.created_at,
      });
    }
    return successResponse(res, created, `${created.length} file(s) linked`);
  } catch (err) { next(err); }
});

// ============================================
// GET /api/tasks/:taskId/attachments — 리스트
// Query: ?context=task → task/description 만 (default, 업무 결과물 영역용)
//        ?context=all  → 댓글 포함 전체
// 30년차 정책: 댓글 첨부는 댓글 안에서만 표시. 업무 결과물 영역은 task/description 만.
//   Irene 명시: "아래 첨부파일은 업무관련 결과물 — 댓글 첨부 중복 표시 X"
// ============================================
router.get('/:taskId/attachments', authenticateToken, async (req, res, next) => {
  try {
    if (!(await loadTaskAndGuard(req, res))) return;
    const ctxParam = String(req.query.context || 'task');
    const where = { task_id: req._task.id };
    if (ctxParam === 'description_attach') {
      where.context = 'description_attach';
    } else if (ctxParam !== 'all') {
      // default: task/description 만 (description_attach·comment 제외 — 결과물 영역용)
      where.context = { [require('sequelize').Op.in]: ['task', 'description'] };
    }
    const rows = await TaskAttachment.findAll({
      where,
      include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
      order: [['created_at', 'DESC']],
    });
    const items = rows.map(r => ({
      id: r.id,
      context: r.context,
      comment_id: r.comment_id,
      original_name: r.original_name,
      file_size: r.file_size,
      mime_type: r.mime_type,
      uploader: r.uploader ? { id: r.uploader.id, name: r.uploader.name } : null,
      download_url: `/api/tasks/attachments/${r.id}/download`,
      preview_url: r.mime_type?.startsWith('image/') ? `/api/tasks/public/attach/${r.stored_name}` : null,
      created_at: r.created_at,
    }));
    await applyMemberDisplayName(items, req._task.business_id, ['uploader']);
    return successResponse(res, items);
  } catch (err) { next(err); }
});

// ============================================
// GET /api/tasks/attachments/:id/raw — 인라인 (이미지/에디터용)
// GET /api/tasks/attachments/:id/download — 다운로드
// ============================================
async function serveAttachment(req, res, next, asDownload) {
  try {
    const att = await TaskAttachment.findByPk(req.params.id);
    if (!att) return errorResponse(res, 'attachment_not_found', 404);
    const task = await Task.findByPk(att.task_id);
    if (!task) return errorResponse(res, 'task_not_found', 404);
    const scope = await getUserScope(req.user.id, att.business_id, req.user.platform_role);
    if (!(await canAccessTask(req.user.id, task, scope))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const abs = path.join(__dirname, '..', att.file_path);
    if (!fs.existsSync(abs)) return errorResponse(res, 'file_missing', 410);
    if (asDownload) {
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.original_name)}`);
    } else {
      res.setHeader('Cache-Control', 'private, max-age=3600');
    }
    if (att.mime_type) res.setHeader('Content-Type', att.mime_type);
    fs.createReadStream(abs).pipe(res);
  } catch (err) { next(err); }
}
// 레거시 URL 호환 — 과거 본문(body)에 저장된 `/raw` URL 은 `<img>` 에서 Authorization 헤더를 보낼 수 없어 401.
// stored_name 이 이미 UUID 기반 접근제어이므로 공개 경로로 302 리다이렉트. 신규 업로드는 이미 /public/attach 경로.
router.get('/attachments/:id/raw', async (req, res, next) => {
  try {
    const att = await TaskAttachment.findByPk(req.params.id);
    if (!att) return errorResponse(res, 'attachment_not_found', 404);
    return res.redirect(302, `/api/tasks/public/attach/${att.stored_name}`);
  } catch (err) { next(err); }
});
router.get('/attachments/:id/download', authenticateToken, (req, res, next) => serveAttachment(req, res, next, true));

// ============================================
// GET /api/tasks/public/attach/:storedName — 공개 (UUID stored_name 으로 접근 제어)
// 이미지 인라인 삽입용. <img src> 에서 Authorization 헤더 못 보내는 제약 대응.
// 보안:
//   - image/* MIME 타입만 허용 (HTML/JS 임베딩으로 인한 XSS 차단)
//   - X-Content-Type-Options: nosniff (브라우저 MIME 추론 차단)
//   - Content-Disposition: inline 로 렌더 컨텍스트 제한
//   - 비이미지 파일은 인증된 /attachments/:id/download 엔드포인트 사용
// ============================================
router.get('/public/attach/:storedName', async (req, res, next) => {
  try {
    const att = await TaskAttachment.findOne({ where: { stored_name: req.params.storedName } });
    if (!att) return errorResponse(res, 'not_found', 404);
    if (!att.mime_type || !att.mime_type.startsWith('image/')) {
      return errorResponse(res, 'not_public_image', 403);
    }
    const abs = path.join(__dirname, '..', att.file_path);
    if (!fs.existsSync(abs)) return errorResponse(res, 'missing', 410);
    if (await require('../services/imageResize').maybeServeResized(req, res, abs, att.mime_type)) return; // #97 ?w= 리사이즈
    res.setHeader('Content-Type', att.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(abs).pipe(res);
  } catch (err) { next(err); }
});

// ============================================
// DELETE /api/tasks/attachments/:id — 첨부 삭제 (업로더 or 관리자)
// ============================================
router.delete('/attachments/:id', authenticateToken, async (req, res, next) => {
  try {
    const att = await TaskAttachment.findByPk(req.params.id);
    if (!att) return errorResponse(res, 'attachment_not_found', 404);
    const task = await Task.findByPk(att.task_id);
    if (!task) return errorResponse(res, 'task_not_found', 404);
    const scope = await getUserScope(req.user.id, att.business_id, req.user.platform_role);
    if (!(await canAccessTask(req.user.id, task, scope))) {
      return errorResponse(res, 'forbidden', 403);
    }
    // 삭제는 업로더 본인 또는 owner — client 도 본인 업로드는 삭제 가능
    if (att.uploaded_by !== req.user.id && !scope.isOwner && !scope.isPlatformAdmin) {
      return errorResponse(res, 'forbidden', 403);
    }

    if (att.storage_provider === 'gdrive' && att.external_id) {
      // Drive 파일 삭제 (실패해도 DB 는 제거). 외부 저장이라 planq 쿼터 미차감.
      try {
        const cloudToken = await BusinessCloudToken.findOne({ where: { business_id: att.business_id, provider: 'gdrive' } });
        if (cloudToken) {
          const drive = await gdrive.getDriveClient(cloudToken);
          await gdrive.deleteFile(drive, att.external_id);
        }
      } catch (e) { console.error('[task_attachments] gdrive delete failed:', e.message); }
    } else {
      // 비용폭탄 재게이트(2026-07-03) — 자체(planq) 저장분. 같은 물리 파일을 참조하는 다른 행이
      //   없을 때만(단독 소유) 물리 삭제 + 쿼터 반환한다. files.js 의 siblings 정책과 동일.
      //   · Q File 링크 첨부(/attachments/link)는 File 행이 물리파일·쿼터를 소유 → 여기서 차감하면
      //     double-decrement. 반대로 업로드가 증가만 하고 삭제가 반환 안 하면 단조증가 → 업로드 잠금(BLOCKER).
      const { Op } = require('sequelize');
      const { releasePlanqUpload } = require('../services/storageUsage');
      const [fileRefs, attRefs] = await Promise.all([
        File.count({ where: { file_path: att.file_path, deleted_at: null } }),
        TaskAttachment.count({ where: { file_path: att.file_path, id: { [Op.ne]: att.id } } }),
      ]);
      const soleOwner = (fileRefs === 0 && attRefs === 0);
      if (soleOwner) {
        const abs = path.join(__dirname, '..', att.file_path);
        try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch (_) { /* ignore */ }
        await releasePlanqUpload(att.business_id, att.file_size).catch((e) => {
          console.warn('[task-attach] usage release failed', e.message);
        });
      }
    }
    await att.destroy();
    return successResponse(res, { id: Number(req.params.id), deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
