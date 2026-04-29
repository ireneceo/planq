const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { File, FileFolder, User, Client, Project, Business, BusinessStorageUsage, BusinessCloudToken,
  MessageAttachment, Message, Conversation, TaskAttachment, Task, PostAttachment, Post } = require('../models');
const { sequelize } = require('../config/database');
const gdrive = require('../services/gdrive');
const planEngine = require('../services/plan');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { attachWorkspaceScope, fileListWhere, isMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// 플랜별 쿼터는 services/plan.js + config/plans.js 에서 관리.
// 이 파일은 plan engine 경유로만 접근.

// ─── 공개 다운로드 (인증 없음) ───
// GET /api/files/public/:token/download
// ⚠️ 라우트 순서 중요: /:businessId/:id/download 보다 앞에 와야 path 매치 우선됨.
router.get('/public/:token/download', async (req, res, next) => {
  try {
    const file = await File.findOne({ where: { share_token: req.params.token, deleted_at: null } });
    if (!file) return errorResponse(res, 'invalid_token', 404);
    if (file.share_expires_at && new Date(file.share_expires_at) < new Date()) {
      return errorResponse(res, 'link_expired', 410);
    }
    if (file.storage_provider !== 'planq') {
      if (file.external_url) return res.redirect(file.external_url);
      return errorResponse(res, 'external_file_no_url', 400);
    }
    if (!fs.existsSync(file.file_path)) return errorResponse(res, 'physical_file_missing', 410);
    res.download(file.file_path, file.file_name);
  } catch (err) { next(err); }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadDir, String(req.params.businessId), new Date().toISOString().slice(0, 7));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// ─── 헬퍼 ───

async function getOrCreateUsage(businessId, transaction) {
  const [usage] = await BusinessStorageUsage.findOrCreate({
    where: { business_id: businessId },
    defaults: { business_id: businessId, bytes_used: 0, file_count: 0, storage_provider: 'planq' },
    transaction
  });
  return usage;
}

async function getPlanQuota(businessId) {
  return await planEngine.getLimit(businessId, 'storage_bytes');
}

function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function verifyProjectOwnership(projectId, businessId) {
  if (!projectId) return true;
  const project = await Project.findOne({ where: { id: projectId, business_id: businessId } });
  return !!project;
}

async function verifyFolderOwnership(folderId, businessId, projectId) {
  if (!folderId) return true;
  const folder = await FileFolder.findOne({
    where: { id: folderId, business_id: businessId, ...(projectId ? { project_id: projectId } : {}) }
  });
  return !!folder;
}

// ─── List ───

router.get('/:businessId', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const baseWhere = await fileListWhere(req.user.id, Number(req.params.businessId), req.scope);
    if (!baseWhere) return errorResponse(res, 'forbidden', 403);
    const where = { ...baseWhere, deleted_at: null };
    if (req.query.client_id) where.client_id = req.query.client_id;
    if (req.query.project_id) where.project_id = req.query.project_id;
    if (req.query.folder_id) where.folder_id = req.query.folder_id;
    if (req.query.folder_id === 'null') where.folder_id = null;

    const files = await File.findAll({
      where,
      include: [
        { model: User, as: 'uploader', attributes: ['id', 'name'] },
        { model: Client, attributes: ['id', 'display_name'] }
      ],
      order: [['created_at', 'DESC']]
    });
    successResponse(res, files);
  } catch (error) {
    next(error);
  }
});

// ─── Storage status (쿼터) ───

router.get('/:businessId/storage', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const usage = await getOrCreateUsage(req.params.businessId);
    const { plan } = await planEngine.getBusinessPlan(req.params.businessId);
    const quota = plan.limits.storage_bytes;
    successResponse(res, {
      provider: usage.storage_provider,
      bytes_used: Number(usage.bytes_used),
      bytes_quota: quota === Infinity ? null : quota,
      file_count: usage.file_count,
      plan: plan.code
    });
  } catch (error) {
    next(error);
  }
});

// ─── Upload (쿼터 + SHA-256 dedup) ───

router.post('/:businessId', authenticateToken, checkBusinessAccess, upload.single('file'), async (req, res, next) => {
  let tempPath = req.file && req.file.path;
  try {
    if (!req.file) return errorResponse(res, 'No file uploaded', 400);

    const businessId = Number(req.params.businessId);
    const projectId = req.body.project_id ? Number(req.body.project_id) : null;
    const folderId = req.body.folder_id ? Number(req.body.folder_id) : null;

    // 소유권 검증
    if (projectId && !(await verifyProjectOwnership(projectId, businessId))) {
      fs.unlinkSync(tempPath);
      return errorResponse(res, 'Invalid project_id', 400);
    }
    if (folderId && !(await verifyFolderOwnership(folderId, businessId, projectId))) {
      fs.unlinkSync(tempPath);
      return errorResponse(res, 'Invalid folder_id', 400);
    }

    // 외부 클라우드 연동 확인 → 있으면 Google Drive 로 업로드 (쿼터 skip)
    const cloudToken = await BusinessCloudToken.findOne({
      where: { business_id: businessId, provider: 'gdrive' }
    });
    const useGdrive = !!cloudToken && !!cloudToken.root_folder_id && projectId;

    // plan engine 통합 체크 — 파일 크기 + 스토리지 쿼터 (외부 사용 시 쿼터 skip)
    // race condition 방지: 실제 usage 증가 트랜잭션은 아래에서 SELECT FOR UPDATE 로 원자화.
    // 여기서의 체크는 1차 early return (UX 개선). 최종 게이트는 트랜잭션 내 재검증.
    const canUpload = await planEngine.can(businessId, 'upload_file', {
      size: req.file.size,
      external: useGdrive,
    });
    if (!canUpload.ok) {
      fs.unlinkSync(tempPath);
      return res.status(canUpload.reason === 'file_size_exceeded' || canUpload.reason === 'storage_quota_exceeded' ? 413 : 403)
        .json(planEngine.buildQuotaError(canUpload, businessId));
    }

    // === Drive 경로 ===
    if (useGdrive) {
      try {
        const project = await Project.findByPk(projectId);
        const drive = await gdrive.getDriveClient(cloudToken);
        // 프로젝트 폴더 확보
        const projectFolderId = await gdrive.ensureProjectFolder(drive, cloudToken, project);
        // 파일 업로드 (stream)
        const driveFile = await gdrive.uploadFile(drive, {
          name: req.file.originalname,
          mimeType: req.file.mimetype,
          body: fs.createReadStream(tempPath),
          parentId: projectFolderId
        });
        // DB 에 메타 저장
        const file = await File.create({
          business_id: businessId,
          project_id: projectId,
          folder_id: folderId,
          client_id: req.body.client_id || null,
          uploader_id: req.user.id,
          file_name: req.file.originalname,
          file_path: driveFile.id,  // gdrive 는 file_path 필드를 external_id 로 활용
          file_size: Number(driveFile.size || req.file.size),
          mime_type: req.file.mimetype,
          description: req.body.description || null,
          storage_provider: 'gdrive',
          external_id: driveFile.id,
          external_url: driveFile.webViewLink
        });
        // 로컬 임시 파일 제거
        fs.unlinkSync(tempPath);
        tempPath = null;
        return successResponse(res, file, 'File uploaded to Drive', 201);
      } catch (e) {
        console.error('[files] gdrive upload failed:', e.message);
        if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        return errorResponse(res, 'Google Drive upload failed: ' + e.message, 502);
      }
    }

    // === 자체 스토리지 경로 ===
    // SHA-256 dedup (트랜잭션 외부에서 해시 계산만)
    const hash = await sha256OfFile(tempPath);

    const t = await sequelize.transaction();
    try {
      // race condition 방지: usage 행 FOR UPDATE lock 으로 직렬화
      await BusinessStorageUsage.findOrCreate({
        where: { business_id: businessId },
        defaults: { business_id: businessId, bytes_used: 0, file_count: 0, storage_provider: 'planq' },
        transaction: t
      });
      const usage = await BusinessStorageUsage.findOne({
        where: { business_id: businessId },
        lock: t.LOCK.UPDATE,
        transaction: t
      });

      // 트랜잭션 내 재검증 — 플랜 쿼터 (early check 이후에도 다른 동시 요청 고려)
      const limit = await planEngine.getLimit(businessId, 'storage_bytes');
      if (limit !== Infinity && Number(usage.bytes_used) + req.file.size > limit) {
        await t.rollback();
        fs.unlinkSync(tempPath);
        return res.status(413).json(planEngine.buildQuotaError(
          { reason: 'storage_quota_exceeded', limit, current: Number(usage.bytes_used) },
          businessId
        ));
      }

      const existing = await File.findOne({
        where: { business_id: businessId, content_hash: hash, deleted_at: null },
        transaction: t
      });

      let file;
      if (existing) {
        // dedup hit — 물리 파일 제거 + 참조 증가
        fs.unlinkSync(tempPath);
        tempPath = null;
        await existing.increment('ref_count', { transaction: t });
        // 같은 파일을 다른 프로젝트/폴더에 올리는 경우 — 별도 레코드로 추가 (같은 file_path 공유)
        if (existing.project_id !== projectId || existing.folder_id !== folderId) {
          file = await File.create({
            business_id: businessId,
            project_id: projectId,
            folder_id: folderId,
            client_id: req.body.client_id || null,
            uploader_id: req.user.id,
            file_name: req.file.originalname,
            file_path: existing.file_path,
            file_size: existing.file_size,
            mime_type: existing.mime_type,
            description: req.body.description || null,
            storage_provider: 'planq',
            content_hash: hash,
            ref_count: 1
          }, { transaction: t });
        } else {
          file = existing;
        }
      } else {
        file = await File.create({
          business_id: businessId,
          project_id: projectId,
          folder_id: folderId,
          client_id: req.body.client_id || null,
          uploader_id: req.user.id,
          file_name: req.file.originalname,
          file_path: req.file.path,
          file_size: req.file.size,
          mime_type: req.file.mimetype,
          description: req.body.description || null,
          storage_provider: 'planq',
          content_hash: hash,
          ref_count: 1
        }, { transaction: t });
        // 쿼터 업데이트 (dedup 히트면 증가 없음)
        usage.bytes_used = Number(usage.bytes_used) + req.file.size;
        usage.file_count += 1;
        await usage.save({ transaction: t });
      }
      await t.commit();
      planEngine.invalidateBusinessCache(businessId);
      tempPath = null;
      successResponse(res, file, 'File uploaded', 201);
    } catch (e) {
      await t.rollback();
      throw e;
    }
  } catch (error) {
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    next(error);
  }
});

// ─── 파일 변경 권한 체크 ───
// 본인 업로드 또는 owner/platform_admin 또는 해당 프로젝트 PM → true
// PERMISSION_MATRIX.md §5.3 — "파일 삭제: 본인 업로드 + owner + PM만"
async function canMutateFile(file, req) {
  if (req.user.platform_role === 'platform_admin') return true;
  if (req.businessRole === 'owner') return true;
  if (file.uploader_id === req.user.id) return true;
  if (file.project_id) {
    try {
      const { ProjectMember } = require('../models');
      const pm = await ProjectMember.findOne({
        where: { project_id: file.project_id, user_id: req.user.id, is_pm: true },
        attributes: ['id'],
      });
      if (pm) return true;
    } catch { /* is_pm 컬럼 없음 (Phase 0 이전) → PM 체크 skip */ }
  }
  return false;
}

// ─── Move (폴더 이동) ───

router.post('/:businessId/:id/move', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, deleted_at: null }
    });
    if (!file) return errorResponse(res, 'File not found', 404);
    if (!(await canMutateFile(file, req))) {
      return errorResponse(res, '본인 업로드 · 오너 · 프로젝트 PM 만 이동할 수 있습니다', 403);
    }

    const folderId = req.body.folder_id ? Number(req.body.folder_id) : null;
    if (folderId && !(await verifyFolderOwnership(folderId, file.business_id, file.project_id))) {
      return errorResponse(res, 'Invalid folder_id', 400);
    }
    file.folder_id = folderId;
    await file.save();
    successResponse(res, file, 'File moved');
  } catch (error) {
    next(error);
  }
});

// ─── Delete (soft) ───

router.delete('/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, deleted_at: null }
    });
    if (!file) return errorResponse(res, 'File not found', 404);
    if (!(await canMutateFile(file, req))) {
      return errorResponse(res, '본인 업로드 · 오너 · 프로젝트 PM 만 삭제할 수 있습니다', 403);
    }

    const t = await sequelize.transaction();
    try {
      await softDeleteFile(file, t);
      await t.commit();
      successResponse(res, null, 'File deleted');
    } catch (e) { await t.rollback(); throw e; }
  } catch (error) {
    next(error);
  }
});

// ─── Bulk delete ───

router.post('/:businessId/bulk-delete', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.file_ids) ? req.body.file_ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) return errorResponse(res, 'file_ids required', 400);

    const files = await File.findAll({
      where: { id: { [Op.in]: ids }, business_id: req.params.businessId, deleted_at: null }
    });

    // 각 파일별 권한 확인 — 권한 없는 것이 하나라도 있으면 부분 실패 대신 전체 거부 (원자성).
    for (const f of files) {
      if (!(await canMutateFile(f, req))) {
        return errorResponse(res, `파일 #${f.id} 에 대한 삭제 권한이 없습니다 (본인 업로드 · 오너 · 프로젝트 PM 만 가능)`, 403);
      }
    }

    const t = await sequelize.transaction();
    try {
      for (const f of files) await softDeleteFile(f, t);
      await t.commit();
      successResponse(res, { deleted: files.length }, `${files.length} files deleted`);
    } catch (e) { await t.rollback(); throw e; }
  } catch (error) {
    next(error);
  }
});

async function softDeleteFile(file, transaction) {
  file.deleted_at = new Date();
  await file.save({ transaction });
  // ref_count 감소 + 0이면 물리 파일 제거
  await file.decrement('ref_count', { transaction });
  await file.reload({ transaction });

  if (file.ref_count <= 0) {
    if (file.storage_provider === 'planq') {
      // 동일 file_path 를 참조하는 다른 활성 레코드 존재 여부 확인
      const siblings = await File.count({
        where: { file_path: file.file_path, deleted_at: null, id: { [Op.ne]: file.id } },
        transaction
      });
      if (siblings === 0 && fs.existsSync(file.file_path)) {
        fs.unlinkSync(file.file_path);
      }
    } else if (file.storage_provider === 'gdrive' && file.external_id) {
      try {
        const cloudToken = await BusinessCloudToken.findOne({
          where: { business_id: file.business_id, provider: 'gdrive' }, transaction
        });
        if (cloudToken) {
          const drive = await gdrive.getDriveClient(cloudToken);
          await gdrive.deleteFile(drive, file.external_id);
        }
      } catch (e) { console.error('[files] gdrive delete failed:', e.message); }
    }
  }
  // 쿼터 반환 (자체 스토리지만 쿼터 사용)
  if (file.storage_provider === 'planq') {
    const usage = await getOrCreateUsage(file.business_id, transaction);
    usage.bytes_used = Math.max(0, Number(usage.bytes_used) - Number(file.file_size));
    usage.file_count = Math.max(0, usage.file_count - 1);
    await usage.save({ transaction });
  }
}

// ─── Download ───

router.get('/:businessId/:id/download', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, deleted_at: null }
    });
    if (!file) return errorResponse(res, 'File not found', 404);
    // Client: 자기 참여 프로젝트 파일 또는 본인 업로드만 다운로드 가능
    if (req.scope?.isClient) {
      const inMyProject = file.project_id && req.scope.projectClientProjectIds.includes(file.project_id);
      const mineUpload = file.uploader_id === req.user.id;
      if (!inMyProject && !mineUpload) return errorResponse(res, 'forbidden', 403);
    }
    if (file.storage_provider !== 'planq') {
      if (file.external_url) return res.redirect(file.external_url);
      return errorResponse(res, 'External file has no URL', 400);
    }
    if (!fs.existsSync(file.file_path)) return errorResponse(res, 'Physical file missing', 410);
    res.download(file.file_path, file.file_name);
  } catch (error) {
    next(error);
  }
});

// ─── 공유 링크 생성 ───
// POST /api/files/:businessId/:id/share-link  body: { expires_days?: 7|14|30|90 }
// 응답: { share_url, share_token, expires_at }
// 기본 만료 30일. 같은 파일에 다시 요청하면 새 토큰 발급 (이전 링크는 무효화).
router.post('/:businessId/:id/share-link', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, deleted_at: null }
    });
    if (!file) return errorResponse(res, 'File not found', 404);

    const expiresDays = [7, 14, 30, 90].includes(Number(req.body?.expires_days))
      ? Number(req.body.expires_days)
      : 30;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresDays * 86400000);
    await file.update({
      share_token: token,
      share_expires_at: expiresAt,
      share_created_at: new Date(),
    });
    const appUrl = process.env.APP_URL || 'https://dev.planq.kr';
    return successResponse(res, {
      share_token: token,
      share_url: `${appUrl}/api/files/public/${token}/download`,
      expires_at: expiresAt.toISOString(),
      expires_days: expiresDays,
    });
  } catch (err) { next(err); }
});

// ─── 공유 링크 해제 ───
// DELETE /api/files/:businessId/:id/share-link
router.delete('/:businessId/:id/share-link', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, deleted_at: null }
    });
    if (!file) return errorResponse(res, 'File not found', 404);
    await file.update({ share_token: null, share_expires_at: null, share_created_at: null });
    return successResponse(res, { ok: true });
  } catch (err) { next(err); }
});

// ─── 대량 다운로드 (ZIP 스트리밍) ───
// POST /api/files/:businessId/bulk-download  body: { ids: ["direct-1", "chat-2", "task-3", ...] }
// composite ID 를 source 별 테이블에서 검색 + 권한 검증 후 ZIP 으로 묶어 스트리밍.
// 지원 source: direct (File), chat (MessageAttachment), task (TaskAttachment).
// post/meeting source 는 후속.
router.post('/:businessId/bulk-download', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (raw.length === 0) return errorResponse(res, 'ids_required', 400);
    if (raw.length > 200) return errorResponse(res, 'too_many_files', 400);

    // composite ID 파싱 — "direct-12", "chat-345", "task-67"
    const parsed = raw.map(s => {
      const m = String(s).match(/^(direct|chat|task)-(\d+)$/);
      return m ? { source: m[1], id: Number(m[2]) } : null;
    }).filter(Boolean);
    if (parsed.length === 0) return errorResponse(res, 'invalid_ids', 400);

    const directIds = parsed.filter(p => p.source === 'direct').map(p => p.id);
    const chatIds = parsed.filter(p => p.source === 'chat').map(p => p.id);
    const taskIds = parsed.filter(p => p.source === 'task').map(p => p.id);

    const items = []; // { name, path }

    // 1) direct = File 테이블, business_id 직접 검증
    if (directIds.length > 0) {
      const direct = await File.findAll({
        where: {
          id: { [Op.in]: directIds },
          business_id: businessId, deleted_at: null, storage_provider: 'planq',
        }
      });
      for (const f of direct) {
        if (f.file_path && fs.existsSync(f.file_path)) {
          items.push({ name: f.file_name, path: f.file_path });
        }
      }
    }

    // 2) chat = MessageAttachment, message → conversation → business 검증
    if (chatIds.length > 0) {
      const chats = await MessageAttachment.findAll({
        where: { id: { [Op.in]: chatIds }, storage_provider: 'planq' },
        include: [{
          model: Message,
          attributes: ['id', 'conversation_id'],
          include: [{
            model: Conversation,
            attributes: ['id', 'business_id'],
            where: { business_id: businessId },
          }],
        }],
      });
      for (const a of chats) {
        if (a.file_path && fs.existsSync(a.file_path)) {
          items.push({ name: a.file_name, path: a.file_path });
        }
      }
    }

    // 3) task = TaskAttachment, business_id 직접 검증
    if (taskIds.length > 0) {
      const tasks = await TaskAttachment.findAll({
        where: {
          id: { [Op.in]: taskIds },
          business_id: businessId, storage_provider: 'planq',
        }
      });
      for (const a of tasks) {
        if (a.file_path && fs.existsSync(a.file_path)) {
          items.push({ name: a.original_name, path: a.file_path });
        }
      }
    }

    if (items.length === 0) return errorResponse(res, 'no_files', 404);

    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 6 } });
    const today = new Date().toISOString().slice(0, 10);
    const zipName = `planq-files-${today}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"; filename*=UTF-8''${encodeURIComponent(zipName)}`);
    archive.on('warning', (err) => { if (err.code !== 'ENOENT') console.warn('[bulk-zip] warn', err.message); });
    archive.on('error', (err) => { console.error('[bulk-zip] err', err); try { res.end(); } catch {} });
    archive.pipe(res);

    // 파일명 충돌 방지 — 동명이 있으면 (1), (2) 접미사
    const usedNames = new Map();
    for (const it of items) {
      let name = it.name;
      const seen = usedNames.get(it.name) || 0;
      if (seen > 0) {
        const ext = path.extname(name);
        const base = name.slice(0, name.length - ext.length);
        name = `${base} (${seen})${ext}`;
      }
      usedNames.set(it.name, seen + 1);
      archive.file(it.path, { name });
    }
    await archive.finalize();
  } catch (err) { next(err); }
});

// ─── 내부 API (Python Q Note ↔ Node) — 사이클 O4 ───
// Q Note 의 link-workspace-file 흐름에서 파일 메타·절대경로 조회.
// 인증: INTERNAL_API_KEY 헤더만 (사용자 토큰 없음).
router.get('/internal/:fileId', async (req, res, next) => {
  try {
    const key = req.header('x-internal-api-key');
    if (!process.env.INTERNAL_API_KEY || key !== process.env.INTERNAL_API_KEY) {
      return errorResponse(res, 'forbidden', 403);
    }
    const fileId = parseInt(req.params.fileId, 10);
    const businessId = req.query.business_id ? parseInt(req.query.business_id, 10) : null;
    if (!fileId || !businessId) return errorResponse(res, 'invalid_params', 400);

    const file = await File.findOne({ where: { id: fileId, business_id: businessId } });
    if (!file) return errorResponse(res, 'file_not_found', 404);

    // file_path 가 상대 경로면 uploadDir 기준 절대 경로로 정규화
    let absPath = file.file_path;
    if (absPath && !path.isAbsolute(absPath)) {
      absPath = path.join(__dirname, '..', absPath);
    }
    return successResponse(res, {
      id: file.id, file_name: file.file_name, file_size: Number(file.file_size),
      mime_type: file.mime_type, storage_provider: file.storage_provider,
      absolute_path: absPath,
    });
  } catch (err) { next(err); }
});

module.exports = router;
