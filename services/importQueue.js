require('dotenv').config()
const path = require('path')
const { Queue, Worker } = require('bullmq')
const mongoose = require('mongoose')
const { processFolder } = require('./worker/processJob')

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS || null
let queue = null
let worker = null

function createQueue() {
  if (!REDIS_URL) return null
  if (queue) return queue
  queue = new Queue('importQueue', { connection: { url: REDIS_URL } })
  return queue
}

async function enqueueImportJob(data = {}) {
  if (!REDIS_URL) throw new Error('REDIS_URL not configured')
  const q = createQueue()
  const job = await q.add('import', data, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } })
  console.log('[importQueue] enqueued job', job.id, 'data=', Object.keys(data))
  return job
}

async function startWorker(opts = {}) {
  if (!REDIS_URL) {
    console.warn('[importQueue] REDIS_URL not set — import queue disabled')
    return
  }
  if (worker) return
  createQueue()
  const concurrency = parseInt(process.env.IMPORT_QUEUE_CONCURRENCY || '1', 10)
  worker = new Worker('importQueue', async job => {
    const data = job.data || {}
    const folder = data.folder || path.resolve(__dirname, '..', 'latest')
    console.log('[importQueue] job active', job.id, 'folder=', folder)
    console.log('[importQueue] processing folder', folder)
    const n = await processFolder(folder)
    return { inserted: n }
  }, { connection: { url: REDIS_URL }, concurrency })
  worker.on('failed', (job, err) => console.error('[importQueue] job failed', job.id, err && err.message ? err.message : err))
  worker.on('completed', (job) => console.log('[importQueue] import job completed', job.id))
  worker.on('progress', (job, progress) => console.log('[importQueue] job progress', job.id, progress))
  worker.on('stalled', (jobId) => console.warn('[importQueue] job stalled', jobId))
  worker.on('error', (err) => console.error('[importQueue] worker error', err && err.message ? err.message : err))
  console.log('[importQueue] worker started, concurrency=', concurrency)
}

module.exports = { enqueueImportJob, startWorker }
