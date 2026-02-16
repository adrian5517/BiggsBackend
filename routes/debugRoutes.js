const express = require('express')
const router = express.Router()
const debugController = require('../controllers/debugController')

router.get('/csv', debugController.getCsv)
router.post('/echo', debugController.echo)

module.exports = router
