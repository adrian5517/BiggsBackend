require('dotenv').config()
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')
const { Queue, Worker } = require('bullmq')
let mongoose = null;
if (String(process.env.ENABLE_MONGO).toLowerCase() === 'true') {
  try { mongoose = require('mongoose') } catch (e) { mongoose = null }
}
const ExportJobMongo = require('../models/exportJobModel')
let ExportJobPg = null
try { ExportJobPg = require('../models/exportJobModel') } catch (e) { /* handled */ }
const masterCtrl = require('../controllers/masterController')

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS || null
const MASTER_OUT = path.join(__dirname, '..', 'master', 'exports')
if (!fs.existsSync(MASTER_OUT)) fs.mkdirSync(MASTER_OUT, { recursive: true })

let queue = null
let worker = null
let scheduler = null

function connectedToMongo() {
  return String(process.env.ENABLE_MONGO).toLowerCase() === 'true' && mongoose.connection.readyState === 1
}

async function ensureMongo() {
  if (String(process.env.ENABLE_MONGO).toLowerCase() !== 'true') {
    console.log('[exportQueue] ENABLE_MONGO!=true — skipping Mongo connection')
    return
  }
  if (connectedToMongo()) return
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/biggs'
  console.log('[exportQueue] Resolved MONGO_URI =', uri)
  await mongoose.connect(uri)
}

function createQueue() {
  if (!REDIS_URL) return null
  if (queue) return queue
  queue = new Queue('exportQueue', { connection: { url: REDIS_URL } })
  return queue
}

async function enqueueExportJob(params = {}, userId = null) {
  if (!REDIS_URL) throw new Error('REDIS_URL not configured')
  const jobId = `exp_${Date.now()}`
  const q = createQueue()

  if (String(process.env.ENABLE_MONGO).toLowerCase() === 'true') {
    await ensureMongo()
    const jobDoc = new ExportJobMongo({ jobId, userId, params, status: 'pending' })
    await jobDoc.save()
    const job = await q.add('export', { exportJobId: jobDoc._id.toString() }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } })
    console.log('[exportQueue] enqueued export job', job.id, 'docId=', jobDoc._id.toString())
    return jobDoc
  }

  // Postgres path
  if (!ExportJobPg) ExportJobPg = require('../models/exportJobModel')
  const jobDoc = await ExportJobPg.create({ jobId, userId, params, status: 'pending' })
  const job = await q.add('export', { exportJobId: String(jobDoc.id) }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } })
  console.log('[exportQueue] enqueued export job (pg)', job.id, 'docId=', jobDoc.id)
  return jobDoc
}

async function startWorker(opts = {}) {
  if (!REDIS_URL) {
    console.warn('[exportQueue] REDIS_URL not set — export queue disabled')
    return
  }
  if (worker) return
  createQueue()
  const concurrency = parseInt(process.env.EXPORT_QUEUE_CONCURRENCY || '2', 10)
  worker = new Worker('exportQueue', async job => {
    // job.data.exportJobId
    const exportJobId = job.data && job.data.exportJobId
    if (!exportJobId) throw new Error('missing exportJobId')
    let jobDoc = null
    if (String(process.env.ENABLE_MONGO).toLowerCase() === 'true') {
      await ensureMongo()
      jobDoc = await ExportJobMongo.findById(exportJobId)
      if (!jobDoc) throw new Error('ExportJob doc not found (mongo)')
    } else {
      if (!ExportJobPg) ExportJobPg = require('../models/exportJobModel')
      jobDoc = await ExportJobPg.findById(Number(exportJobId))
      if (!jobDoc) throw new Error('ExportJob doc not found (pg)')
    }

    try {
      console.log('[exportQueue] processing job', job.id, 'exportJobId=', exportJobId)
      jobDoc.status = 'running'
      await jobDoc.save()
      const filename = `${jobDoc.jobId}.csv.gz`
      const outPath = path.join(MASTER_OUT, filename)
      jobDoc.fileName = filename
      await jobDoc.save()

      const out = fs.createWriteStream(outPath)
      const gzip = zlib.createGzip()
      gzip.pipe(out)
      // stream results to gzip
      await masterCtrl.streamSearchCsvToStream(jobDoc.params || {}, gzip)
      gzip.end()
      await new Promise((res, rej) => out.on('close', res).on('error', rej))

      jobDoc.status = 'done'
      jobDoc.progress = 100
      await jobDoc.save()
      return { ok: true }
    } catch (e) {
      jobDoc.status = 'failed'
      jobDoc.error = String(e.message || e)
      await jobDoc.save()
      throw e
    }
  }, { connection: { url: REDIS_URL }, concurrency })

  worker.on('failed', (job, err) => {
    console.error('[exportQueue] job failed', job.id, err && err.message ? err.message : err)
  })

  worker.on('completed', (job) => {
    console.log('[exportQueue] job completed', job.id)
  })
  worker.on('progress', (job, progress) => console.log('[exportQueue] job progress', job.id, progress))
  worker.on('stalled', (jobId) => console.warn('[exportQueue] job stalled', jobId))
  worker.on('error', (err) => console.error('[exportQueue] worker error', err && err.message ? err.message : err))
  console.log('[exportQueue] worker started, concurrency=', concurrency)
}

module.exports = { enqueueExportJob, startWorker }
