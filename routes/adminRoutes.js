const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const adminController = require('../controllers/adminController');

router.get('/retention/status', authMiddleware.protect, adminMiddleware.requireAdmin, adminController.getRetentionStatus);
router.post('/retention/run', authMiddleware.protect, adminMiddleware.requireAdmin, adminController.runRetention);

router.get('/backups', authMiddleware.protect, adminMiddleware.requireAdmin, adminController.listBackups);
router.delete('/backups/:id', authMiddleware.protect, adminMiddleware.requireAdmin, adminController.deleteBackup);
router.post('/backups/:id/restore', authMiddleware.protect, adminMiddleware.requireAdmin, adminController.restoreBackup);

module.exports = router;
