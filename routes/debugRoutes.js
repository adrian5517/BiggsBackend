const express = require('express')
const router = express.Router()
const debugController = require('../controllers/debugController')

router.get('/csv', debugController.getCsv)

module.exports = router
