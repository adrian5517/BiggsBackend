require('dotenv').config()
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')
let mongoose = null;
if (String(process.env.ENABLE_MONGO).toLowerCase() === 'true') {
  try { mongoose = require('mongoose') } catch (e) { mongoose = null }
}
const ExportJob = require('../models/exportJobModel')
const masterCtrl = require('../controllers/masterController')

const MASTER_OUT = path.join(__dirname, '..', 'master', 'exports')
if (!fs.existsSync(MASTER_OUT)) fs.mkdirSync(MASTER_OUT, { recursive: true })

let polling = false

async function connectIfNeeded() {
  if (String(process.env.ENABLE_MONGO).toLowerCase() !== 'true') {
    console.log('[exportWorker] ENABLE_MONGO!=true — skipping Mongo connection and worker activities')
    return
  }
  if (mongoose.connection.readyState === 1) return
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/biggs'
  console.log('[exportWorker] Resolved MONGO_URI =', uri)
  await mongoose.connect(uri)
}

async function processJob(job) {
  try {
    console.log('[exportWorker] processing job', job.jobId)
    job.status = 'running'
    await job.save()

    const filename = `${job.jobId}.csv.gz`
    const outPath = path.join(MASTER_OUT, filename)
    job.fileName = filename
    await job.save()

    const out = fs.createWriteStream(outPath)
    const gzip = zlib.createGzip()
    gzip.pipe(out)

    await masterCtrl.streamSearchCsvToStream(job.params || {}, gzip)
    gzip.end()
    await new Promise((res, rej) => out.on('close', res).on('error', rej))

    job.status = 'done'
    job.progress = 100
    await job.save()
    console.log('[exportWorker] job done', job.jobId)
  } catch (e) {
    console.error('[exportWorker] job error', e)
    job.status = 'failed'
    job.error = String(e.message || e)
    await job.save()
  }
}

async function pollLoop() {
  if (polling) return
  polling = true
  try {
    if (String(process.env.ENABLE_MONGO).toLowerCase() !== 'true') return
    await connectIfNeeded()
    // pick one pending job
    let job = null
    if (String(process.env.ENABLE_MONGO).toLowerCase() === 'true') {
      job = await ExportJob.findOneAndUpdate({ status: 'pending' }, { $set: { status: 'running' } }, { returnDocument: 'after' })
      if (!job) return
      await processJob(job)
    } else {
      // Postgres path: claim one pending job
      const PgExportJob = require('../models/exportJobModel')
      job = await PgExportJob.findPendingAndClaim()
      if (!job) return
      await processJob(job)
    }
  } catch (e) {
    console.error('[exportWorker] poll error', e)
  } finally {
    polling = false
  }
}

let pollHandle = null
function startPolling(intervalMs = 2000) {
  if (pollHandle) return
  pollHandle = setInterval(pollLoop, intervalMs)
  console.log('[exportWorker] started poller')
}

async function startOnce() {
  await connectIfNeeded()
  // process any pending jobs once then start polling
  const pending = await ExportJob.find({ status: { $in: ['pending','running'] } }).sort({ createdAt: 1 }).limit(5)
  for (const j of pending) {
    try { await processJob(j) } catch (e) { console.error('startOnce error', e) }
  }
  startPolling()
}

if (require.main === module) {
  startOnce().catch(e => console.error(e))
}

module.exports = { start: startOnce, startPolling, processJob }
