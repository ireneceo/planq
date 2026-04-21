const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { Task, TaskAttachment, TaskComment, User, BusinessMember, BusinessCloudToken, Project } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const gdrive = require('../services/gdrive');

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
  const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: task.business_id } });
  if (!bm) { errorResponse(res, 'forbidden', 403); return null; }
  req._task = task;
  return task;
}

// ============================================
// POST /api/tasks/:taskId/attachments — 업로드 (task/description/comment 공통)
// Query: ?context=task|description|comment  ?commentId=...
// ============================================
router.post('/:taskId/attachments',
  authenticateToken,
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
      const context = ['description', 'comment'].includes(req.query.context) ? req.query.context : 'task';
      const commentId = context === 'comment' ? Number(req.query.commentId || 0) || null : null;
      if (context === 'comment' && !commentId) return errorResponse(res, 'commentId_required', 400);

      // Drive 연동 + 프로젝트 소속 task 면 Drive 로 업로드
      let storageProvider = 'planq';
      let externalId = null;
      let externalUrl = null;
      let finalFilePath = path.relative(path.join(__dirname, '..'), req.file.path).replace(/\\/g, '/');
      let finalStoredName = path.basename(req.file.path);

      const cloudToken = await BusinessCloudToken.findOne({
        where: { business_id: req._task.business_id, provider: 'gdrive' }
      });
      if (cloudToken && cloudToken.root_folder_id && req._task.project_id) {
        try {
          const project = await Project.findByPk(req._task.project_id);
          if (project) {
            const drive = await gdrive.getDriveClient(cloudToken);
            const projectFolderId = await gdrive.ensureProjectFolder(drive, cloudToken, project);
            const driveFile = await gdrive.uploadFile(drive, {
              name: req.file.originalname,
              mimeType: req.file.mimetype,
              body: fs.createReadStream(req.file.path),
              parentId: projectFolderId
            });
            storageProvider = 'gdrive';
            externalId = driveFile.id;
            externalUrl = driveFile.webViewLink;
            finalFilePath = driveFile.id;         // 외부 저장 시 external_id 를 경로로
            finalStoredName = driveFile.id;
            // 로컬 임시 파일 제거
            fs.unlinkSync(req.file.path);
          }
        } catch (e) {
          console.error('[task_attachments] gdrive upload failed:', e.message);
          // 실패 시 로컬 유지
        }
      }

      const att = await TaskAttachment.create({
        business_id: req._task.business_id,
        task_id: req._task.id,
        comment_id: commentId,
        context,
        original_name: req.file.originalname,
        stored_name: finalStoredName,
        file_path: finalFilePath,
        file_size: req.file.size,
        mime_type: req.file.mimetype,
        uploaded_by: req.user.id,
        storage_provider: storageProvider,
        external_id: externalId,
        external_url: externalUrl,
      });
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
// GET /api/tasks/:taskId/attachments — 리스트 (task + comment 모두)
// ============================================
router.get('/:taskId/attachments', authenticateToken, async (req, res, next) => {
  try {
    if (!(await loadTaskAndGuard(req, res))) return;
    const rows = await TaskAttachment.findAll({
      where: { task_id: req._task.id },
      include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
      order: [['created_at', 'DESC']],
    });
    return successResponse(res, rows.map(r => ({
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
    })));
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
    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: att.business_id } });
    if (!bm) return errorResponse(res, 'forbidden', 403);
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
// stored_name 은 uuidv4 (추측 불가), HTML 에 저장되는 URL 은 업무 body 안에만 존재.
// ============================================
router.get('/public/attach/:storedName', async (req, res, next) => {
  try {
    const att = await TaskAttachment.findOne({ where: { stored_name: req.params.storedName } });
    if (!att) return errorResponse(res, 'not_found', 404);
    const abs = path.join(__dirname, '..', att.file_path);
    if (!fs.existsSync(abs)) return errorResponse(res, 'missing', 410);
    if (att.mime_type) res.setHeader('Content-Type', att.mime_type);
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
    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: att.business_id } });
    if (!bm) return errorResponse(res, 'forbidden', 403);
    if (att.uploaded_by !== req.user.id && bm.role !== 'owner') return errorResponse(res, 'forbidden', 403);

    if (att.storage_provider === 'gdrive' && att.external_id) {
      // Drive 파일 삭제 (실패해도 DB 는 제거)
      try {
        const cloudToken = await BusinessCloudToken.findOne({ where: { business_id: att.business_id, provider: 'gdrive' } });
        if (cloudToken) {
          const drive = await gdrive.getDriveClient(cloudToken);
          await gdrive.deleteFile(drive, att.external_id);
        }
      } catch (e) { console.error('[task_attachments] gdrive delete failed:', e.message); }
    } else {
      const abs = path.join(__dirname, '..', att.file_path);
      try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch (_) { /* ignore */ }
    }
    await att.destroy();
    return successResponse(res, { id: Number(req.params.id), deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
