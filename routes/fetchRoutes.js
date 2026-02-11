const express = require('express');
const router = express.Router();

const fetchController = require('../controllers/fetchController');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/status/stream', authMiddleware.protectWithQueryToken, fetchController.streamStatus);
router.post('/start', authMiddleware.protect, fetchController.startFetch);
router.post('/start-from-log', authMiddleware.protect, fetchController.startFromLog);
router.post('/missing', authMiddleware.protect, fetchController.startMissingFetch);

module.exports = router;
