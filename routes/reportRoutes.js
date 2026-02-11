const express = require('express');
const router = express.Router();

const fetchController = require('../controllers/fetchController');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/', authMiddleware.protect, fetchController.getReports);

module.exports = router;
