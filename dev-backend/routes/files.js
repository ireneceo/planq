const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { File, User, Client } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadDir, req.params.businessId);
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
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// List files
router.get('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const where = { business_id: req.params.businessId };
    if (req.query.client_id) where.client_id = req.query.client_id;

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

// Upload file
router.post('/:businessId', authenticateToken, checkBusinessAccess, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, 'No file uploaded', 400);

    const file = await File.create({
      business_id: req.params.businessId,
      client_id: req.body.client_id || null,
      uploader_id: req.user.id,
      file_name: req.file.originalname,
      file_path: req.file.path,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      description: req.body.description || null
    });
    successResponse(res, file, 'File uploaded', 201);
  } catch (error) {
    next(error);
  }
});

// Delete file
router.delete('/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }
    });
    if (!file) return errorResponse(res, 'File not found', 404);

    if (fs.existsSync(file.file_path)) {
      fs.unlinkSync(file.file_path);
    }

    await file.destroy();
    successResponse(res, null, 'File deleted');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
