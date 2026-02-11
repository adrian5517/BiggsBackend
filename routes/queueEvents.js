const express = require('express')
const router = express.Router()
const { sse } = require('../controllers/queueSseController')

router.get('/', sse)

module.exports = router
