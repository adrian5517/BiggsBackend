const express = require('express')
const multer = require('multer')
const path = require('path')
const router = express.Router()
const { handleUpload } = require('../controllers/uploadController')

// multer storage into ./latest (existing folder used by worker)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.resolve(process.cwd(), 'latest'))
  },
  filename: function (req, file, cb) {
    // keep original filename
    cb(null, file.originalname)
  }
})

const upload = multer({ storage })

// Accept multiple files (frontend should upload the 7 CSVs)
router.post('/', upload.any(), handleUpload)

module.exports = router

