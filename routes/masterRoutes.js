const express = require('express')
const router = express.Router()
const masterCtrl = require('../controllers/masterController')
const authMiddleware = require('../middleware/authMiddleware')
const ExportJob = require('../models/exportJobModel')
let exportQueue = null
try { exportQueue = require('../services/exportQueue') } catch (e) { console.warn('exportQueue not available', e.message) }

router.get('/', authMiddleware.protect, (req, res) => {
  const page = req.query.page || req.body.page
  const limit = req.query.limit || req.body.limit
  const q = req.query.q || req.body.q
  const branch = req.query.branch || req.body.branch
  const date = req.query.date || req.body.date

  const result = masterCtrl.listMastersFiltered({ page, limit, q, branch, date })
  res.json(result)
})

router.get('/:key', authMiddleware.protect, (req, res) => {
  const key = req.params.key
  // stream decompressed ndjson
  masterCtrl.streamMasterDecompressed(key, res)
})

router.get('/:key/preview', authMiddleware.protect, async (req, res) => {
  const key = req.params.key
  const n = parseInt(req.query.n || '5', 10)
  try {
    const rows = await masterCtrl.readFirstN(key, n)
    res.json({ rows })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// search across imported master transactions (uses Mongo)
router.get('/search', authMiddleware.protect, async (req, res) => {
  try {
    const params = {
      page: req.query.page || req.body.page,
      limit: req.query.limit || req.body.limit,
      q: req.query.q || req.body.q,
      branch: req.query.branch || req.body.branch,
      pos: req.query.pos || req.body.pos,
      productCode: req.query.productCode || req.body.productCode,
      productName: req.query.productName || req.body.productName,
      minAmount: req.query.minAmount || req.body.minAmount,
      maxAmount: req.query.maxAmount || req.body.maxAmount,
      date: req.query.date || req.body.date,
      dateFrom: req.query.dateFrom || req.body.dateFrom,
      dateTo: req.query.dateTo || req.body.dateTo,
    }
    const result = await masterCtrl.searchTransactions(params)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/export', authMiddleware.protect, async (req, res) => {
  // streams CSV for a full search result
  try {
    masterCtrl.streamSearchCsv(req, res)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// create an export job (background)
router.post('/export-job', authMiddleware.protect, async (req, res) => {
  try {
    const userId = req.user && req.user._id
    // rate limit: max 2 running jobs per user
    const running = await ExportJob.countDocuments({ userId, status: { $in: ['pending','running'] } })
    if (running >= 2) return res.status(429).json({ message: 'Too many export jobs running' })

    const jobId = `exp_${Date.now()}`
    const params = {
      q: req.body.q || req.query.q,
      branch: req.body.branch || req.query.branch,
      pos: req.body.pos || req.query.pos,
      productCode: req.body.productCode || req.query.productCode,
      productName: req.body.productName || req.query.productName,
      minAmount: req.body.minAmount || req.query.minAmount,
      maxAmount: req.body.maxAmount || req.query.maxAmount,
      date: req.body.date || req.query.date,
      dateFrom: req.body.dateFrom || req.query.dateFrom,
      dateTo: req.body.dateTo || req.query.dateTo,
    }
    // create ExportJob doc, then enqueue via Redis queue if available
    const job = new ExportJob({ jobId, userId, params, status: 'pending' })
    await job.save()
    if (exportQueue && exportQueue.enqueueExportJob) {
      try {
        await exportQueue.enqueueExportJob(params, userId)
      } catch (e) {
        // fallback: leave job pending for legacy worker
        console.warn('enqueueExportJob failed', e.message)
      }
    }
    res.json({ jobId: job.jobId, id: job._id, status: job.status })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/export-job/:id', authMiddleware.protect, async (req, res) => {
  try {
    const job = await ExportJob.findById(req.params.id).lean()
    if (!job) return res.status(404).json({ message: 'Not found' })
    res.json(job)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/export-job/:id/download', authMiddleware.protect, async (req, res) => {
  try {
    const job = await ExportJob.findById(req.params.id)
    if (!job) return res.status(404).json({ message: 'Not found' })
    if (job.status !== 'done' || !job.fileName) return res.status(400).json({ message: 'Job not ready' })
    const filePath = require('path').join(__dirname, '..', 'master', 'exports', job.fileName)
    if (!require('fs').existsSync(filePath)) return res.status(404).json({ message: 'File missing' })
    res.setHeader('Content-Type', 'application/gzip')
    res.setHeader('Content-Disposition', `attachment; filename="${job.fileName}"`)
    require('fs').createReadStream(filePath).pipe(res)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
