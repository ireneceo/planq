const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { File, FileFolder, User, Client, Project, Business, BusinessStorageUsage, BusinessCloudToken } = require('../models');
const { sequelize } = require('../config/database');
const gdrive = require('../services/gdrive');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// 플랜별 쿼터 (bytes). Stage 0 — 운영 기준
const PLAN_QUOTAS = {
  free: 1 * 1024 * 1024 * 1024,          // 1GB
  basic: 50 * 1024 * 1024 * 1024,        // 50GB
  pro: 500 * 1024 * 1024 * 1024          // 500GB
};
const DEFAULT_PLAN = 'basic';

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
  const biz = await Business.findByPk(businessId);
  const plan = (biz && biz.plan) || DEFAULT_PLAN;
  return PLAN_QUOTAS[plan] || PLAN_QUOTAS[DEFAULT_PLAN];
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

router.get('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const where = { business_id: req.params.businessId, deleted_at: null };
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
    const quota = await getPlanQuota(req.params.businessId);
    const biz = await Business.findByPk(req.params.businessId);
    successResponse(res, {
      provider: usage.storage_provider,
      bytes_used: Number(usage.bytes_used),
      bytes_quota: quota,
      file_count: usage.file_count,
      plan: (biz && biz.plan) || DEFAULT_PLAN
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

    // Drive 연동 확인 → 있으면 Drive 로 업로드 (쿼터는 Drive 한도 사용)
    const cloudToken = await BusinessCloudToken.findOne({
      where: { business_id: businessId, provider: 'gdrive' }
    });
    const useGdrive = !!cloudToken && !!cloudToken.root_folder_id && projectId;

    if (!useGdrive) {
      // 자체 스토리지 쿼터 체크 (Drive 사용 시에는 skip)
      const usage = await getOrCreateUsage(businessId);
      const quota = await getPlanQuota(businessId);
      if (Number(usage.bytes_used) + req.file.size > quota) {
        fs.unlinkSync(tempPath);
        return errorResponse(res, 'Storage quota exceeded', 413);
      }
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

    // === 자체 스토리지 경로 (아래) ===
    // Drive 미사용 시에만 쿼터/dedup 처리
    const usage = await getOrCreateUsage(businessId);
    // SHA-256 dedup
    const hash = await sha256OfFile(tempPath);
    const existing = await File.findOne({
      where: { business_id: businessId, content_hash: hash, deleted_at: null }
    });

    const t = await sequelize.transaction();
    try {
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

// ─── Move (폴더 이동) ───

router.post('/:businessId/:id/move', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, deleted_at: null }
    });
    if (!file) return errorResponse(res, 'File not found', 404);

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
      // Drive 파일 삭제 — 실패해도 DB 소프트 삭제는 유지 (fallback)
      try {
        const cloudToken = await BusinessCloudToken.findOne({
          where: { business_id: file.business_id, provider: 'gdrive' },
          transaction
        });
        if (cloudToken) {
          const drive = await gdrive.getDriveClient(cloudToken);
          await gdrive.deleteFile(drive, file.external_id);
        }
      } catch (e) {
        console.error('[files] gdrive delete failed:', e.message);
      }
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

router.get('/:businessId/:id/download', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, deleted_at: null }
    });
    if (!file) return errorResponse(res, 'File not found', 404);
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

module.exports = router;
