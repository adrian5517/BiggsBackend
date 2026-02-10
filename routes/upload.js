const express = require('express');
const router = express.Router();
const upload = require('../middleware/uploadMiddleware');

// Simple upload endpoint used by server mounting at /api/upload and /upload
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    // For now, return basic metadata. Cloudinary upload is handled elsewhere.
    return res.status(200).json({
      success: true,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size
    });
  } catch (err) {
    console.error('Upload route error:', err);
    return res.status(500).json({ success: false, message: 'Upload failed', error: err.message });
  }
});

module.exports = router;
