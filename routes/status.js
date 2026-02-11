const express = require('express');
const router = express.Router();
const { status } = require('../controllers/statusController');

router.get('/', status);

module.exports = router;
