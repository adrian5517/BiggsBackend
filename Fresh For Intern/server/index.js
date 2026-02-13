const express = require('express')
const { MongoClient } = require('mongodb')
const fs = require('fs')
const path = require('path')
const Fetcher = require('./streamWorker')

const app = express()
app.use(express.json())

const clients = new Map() // jobId -> [res, ...]

async function main() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017'
  const client = new MongoClient(mongoUri)
  await client.connect()
  const db = client.db('biggs')

  const fetcher = new Fetcher(db, { parentDir: process.cwd() })

  // SSE endpoint for progress
  app.get('/api/fetch/status/stream', (req, res) => {
    const jobId = req.query.jobId || 'global'
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write('\n')
    if (!clients.has(jobId)) clients.set(jobId, [])
    clients.get(jobId).push(res)
    req.on('close', () => {
      const arr = clients.get(jobId) || []
      clients.set(jobId, arr.filter(r => r !== res))
    })
  })

  // Hook worker events to SSE broadcast
  fetcher.on('progress', (data) => {
    const msg = `data: ${JSON.stringify({ type: 'progress', ...data })}\n\n`
    ;(clients.get(data.jobId || 'global') || []).forEach(r => r.write(msg))
  })
  fetcher.on('error', (err) => {
    const msg = `data: ${JSON.stringify({ type: 'error', ...err })}\n\n`
    ;(clients.get(err.jobId || 'global') || []).forEach(r => r.write(msg))
  })

  // Start fetch route
  app.post('/api/fetch/start', async (req, res) => {
    const { start, end } = req.body || {}
    const jobId = `${Date.now()}`
    res.json({ jobId })

    // load branches list from settings/branches.txt
    const branchesPath = path.join(process.cwd(), 'settings', 'branches.txt')
    let branches = []
    try { branches = fs.readFileSync(branchesPath, 'utf8').split(/\r?\n/).filter(Boolean) } catch (e) { branches = [] }

    // spawn job (fire-and-forget)
    (async () => {
      // for simplicity iterate only the start date; production should iterate date range
      const dateToRun = start
      for (const branch of branches.length ? branches : ['BR1']) {
        for (const pos of [1,2]) {
          try {
            const rows = await fetcher.runFor(branch, pos, dateToRun, { jobId })
            fetcher.emit('progress', { jobId, branch, pos, rows })
          } catch (e) {
            fetcher.emit('error', { jobId, branch, pos, message: e.message })
          }
        }
      }
      // After finishing a date, optionally trigger Python Combiner if desired
      // e.g., spawn('python', ['combiner_runner.py']) or call a command to run Combiner.generate()
    })()
  })

  // Missing fetch route accepts branches_missing structure
  app.post('/api/fetch/missing', async (req, res) => {
    const branches_missing = req.body
    const jobId = `${Date.now()}`
    res.json({ jobId })
    (async () => {
      for (const [branch, posObj] of Object.entries(branches_missing)) {
        for (const [posStr, dates] of Object.entries(posObj)) {
          const pos = Number(posStr)
          for (const date of dates) {
            try {
              const rows = await fetcher.runFor(branch, pos, date, { jobId })
              fetcher.emit('progress', { jobId, branch, pos, date, rows })
            } catch (e) {
              fetcher.emit('error', { jobId, branch, pos, date, message: e.message })
            }
          }
        }
      }
    })()
  })

  const port = process.env.PORT || 3000
  app.listen(port, () => console.log(`Fetch server listening on ${port}`))
}

main().catch(err => { console.error(err); process.exit(1) })
