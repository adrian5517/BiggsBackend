const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { uploadQueue } = require('../services/queue');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Simple disk storage for staging uploads (can be replaced with S3)
const uploadDir = process.env.UPLOAD_STAGING_DIR || path.join(__dirname, '..', 'tmp', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({ storage });

// POST /api/upload
// Protect upload route with auth middleware
router.post('/', authMiddleware.protect, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'file required' });

    // Prefer authenticated user id set by `authMiddleware.protect`
    const userId = req.user ? req.user.id : (req.headers['x-user-id'] || 'anonymous');

    // Enqueue the job: payload contains staging path and minimal metadata
    const job = await uploadQueue.add('process-upload', {
      stagingPath: req.file.path,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      userId,
    }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } });

    return res.status(202).json({ jobId: job.id, queued: true });
  } catch (err) {
    console.error('Upload enqueue error', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: 'Could not enqueue upload job' });
  }
});

module.exports = router;

