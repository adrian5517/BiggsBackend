# Webapp Implementation: Streaming POS Fetcher & Dashboard

This document describes an implementation plan, API spec, streaming approach, data model and frontend integration to port the existing Python fetcher/combiner functionality into a Next.js + Express + Node.js + MongoDB webapp. Admin login is assumed complete.

## Goals
- Stream POS CSV files from the Biggs cloud API chunk-by-chunk, parse and ingest into MongoDB in batched writes.
- Provide real-time dashboard progress and logs to the admin dashboard using Server-Sent Events (SSE) or WebSocket.
- Expose endpoints to trigger full fetch, missing-data fetch, and review stored data.

## Architecture Overview
- Next.js (frontend) — admin dashboard pages/components.
- Express (API server) — routes for starting fetch jobs, SSE progress stream, and CRUD for stored records.
- Worker (in-process or separate Node.js worker) — performs HTTP fetching, streaming-parsing and inserts into MongoDB.
- MongoDB — collections: `reports`, `branches`, `fetch_logs`.

## Key API Endpoints (Express)
- `POST /api/fetch/start` — start fetch for date range { start, end } or named mode `missing` with payload describing missing structure.
- `GET  /api/fetch/status/stream` — SSE endpoint that streams progress events (jobId, progress, message).
- `GET  /api/reports?branch=&date=` — query inserted records for dashboard views (pagination).
- `POST /api/fetch/missing` — trigger missing-only fetch with JSON structure (branches_missing).

Example request body to `POST /api/fetch/start`:

```
{
  "start": "2025-08-01",
  "end": "2025-08-31"
}
```

## Streaming & Chunking Strategy
- Use `axios` (or `node-fetch`) with `responseType: 'stream'` to get a readable stream from the remote CSV file URL.
- Pipe the stream to a line-split parser (for example `split2` or `csv-parse` in streaming mode) to parse CSV rows incrementally.
- Buffer rows into small batches (e.g., 500–2000 rows) and perform bulk writes to MongoDB using `insertMany` for throughput.
- Emit progress events to SSE clients after each batch (e.g., `{ jobId, branch, pos, date, rowsProcessed }`).
- Store a `fetch_logs` document per job with final status (completed/failed), timestamps, and error trace.

Minimal Express stream handler pseudocode (server side):

```js
// use axios + split2 + csv-parse
const axios = require('axios')
const split2 = require('split2')
const parse = require('csv-parse')

async function streamAndIngest(url, metadata, db, progressEmitter) {
  const res = await axios.get(url, { responseType: 'stream', timeout: 60000 })
  const parser = res.data.pipe(split2()).pipe(parse({ columns: true, relax_quotes: true }))

  let batch = []
  for await (const row of parser) {
    // normalize row (trim, unicode normalize, type conversions)
    batch.push(transformRow(row, metadata))
    if (batch.length >= 1000) {
      await db.collection('reports').insertMany(batch)
      progressEmitter({ rows: batch.length })
      batch = []
    }
  }
  if (batch.length) await db.collection('reports').insertMany(batch)
}
```

Notes:
- If the remote server requires POST with form data (branch/pos/date), send form request first to get file path, then call the file URL.
- Use retry/backoff per file download attempt.


## Streaming Implementation — Step-by-step
This section shows concrete code and wiring steps to implement streaming ingestion in Express using the `Fetcher` worker (see `server/streamWorker.js`). The examples use `axios`, `csv-parse`, and MongoDB native driver.

1) Install dependencies

```bash
npm install express axios csv-parse mongodb
```

2) Minimal `server/index.js` (wiring + SSE)

```js
const express = require('express')
const { MongoClient } = require('mongodb')
const Fetcher = require('./streamWorker')

const app = express()
app.use(express.json())

const clients = new Map() // jobId -> [res, ...]

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017')
  await client.connect()
  const db = client.db('biggs')

  const fetcher = new Fetcher(db)

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
    (clients.get(data.jobId || 'global') || []).forEach(r => r.write(msg))
  })
  fetcher.on('error', (err) => {
    const msg = `data: ${JSON.stringify({ type: 'error', ...err })}\n\n`
    (clients.get(err.jobId || 'global') || []).forEach(r => r.write(msg))
  })

  // Start fetch route
  app.post('/api/fetch/start', async (req, res) => {
    const { start, end } = req.body
    const jobId = `${Date.now()}`
    res.json({ jobId })

    // spawn job (fire-and-forget) — iterate dates/branches/pos as needed
    (async () => {
      for (const branch of ['BR1','BR2']) {
        for (const pos of [1,2]) {
          // you would loop dates between start/end
          try {
            const rows = await fetcher.runFor(branch, pos, start, { jobId })
            fetcher.emit('progress', { jobId, branch, pos, rows })
          } catch (e) {
            fetcher.emit('error', { jobId, branch, pos, message: e.message })
          }
        }
      }
    })()
  })

  app.listen(3000)
}

main().catch(console.error)
```

3) `server/streamWorker.js` already provides `Fetcher` with `streamAndIngest` and `runFor()` — it emits `progress` and `error` events. Keep transforms and batch sizes configurable.

4) Next.js SSE client

```js
useEffect(() => {
  const es = new EventSource('/api/fetch/status/stream?jobId=GLOBAL')
  es.onmessage = (ev) => {
    const d = JSON.parse(ev.data)
    if (d.type === 'progress') setProgress(prev => [...prev, d])
  }
  return () => es.close()
}, [])
```

5) Resume & partial progress
- Persist `fetch_logs` documents per job with last processed (branch,pos,date,file) so interrupted jobs can resume. Update `fetch_logs` after each successful `insertMany`.

6) Notes on security & production
- Protect API endpoints behind admin auth.
- Use a job queue (BullMQ / Redis) for heavy workloads and concurrency control if needed.
- Monitor memory when parsing huge files; prefer streaming parsers and small batch sizes.


## How Streaming Keeps the System Responsive (no-lag design)
This section explains how the streaming approach maps to the project's current fetch/combiner flow (see `fetcher.py` and `combiner.py`) and the runtime practices that keep the webapp responsive and low-latency.

- Stream-first, persist-later: instead of downloading full CSV files to disk and then loading them into memory, the worker parses each file as a stream and writes small batches to MongoDB (e.g., 250–2000 rows). This avoids large in-memory buffers and long single-threaded blocking operations.

- Backpressure-aware parsing: use Node stream/pipeline or `for await` with `csv-parse` so the parser naturally respects backpressure. Pause the network stream while `insertMany` runs and resume after the write completes to prevent memory growth.

- Small, frequent bulk writes: performing periodic `insertMany` for small batches keeps write latency predictable and allows other requests (SSE, API queries) to complete promptly. MongoDB handles concurrent reads/writes; keep indexes lean to reduce write amplification.

- Concurrency limits per job: limit the number of simultaneous file downloads/parses (e.g., 2–4 parallel files). The Python `fetcher` currently processes branches/pos sequentially — the Node worker should parallelize at the branch level but with a configurable concurrency cap to avoid IO saturation.

- Offload expensive work: heavy combiner logic that joins reference tables can run incrementally after rows are inserted (a downstream worker or a scheduled job). This prevents the ingestion pipeline from blocking on CPU-heavy transforms. Alternatively, perform lightweight normalization during ingestion and run the full `Combiner` merge as a separate step.

- Use streaming UI updates: the SSE/WebSocket progress channel keeps the dashboard updated chunk-by-chunk (each `insertMany` emits a progress event). The admin sees steady progress without waiting for job completion.

- Resume and idempotency: record per-job progress in `fetch_logs` (last branch/pos/date/file and last inserted row count). If a job is interrupted, resume from the last saved point; design ingestion to be idempotent (use unique keys or upserts where appropriate) so retries do not duplicate rows.

- Avoid combiner file I/O: the original `Combiner` expects files under `latest/`. To avoid repeated disk reads and to keep streaming benefits, either:
  - Convert combiner logic to operate on the `reports` collection (recommended), running joining/aggregation queries in MongoDB; or
  - Run the Python `Combiner` as a separate process that reads from MongoDB (or reads small temporary files produced from streaming batches) instead of scanning full downloaded files.

- Resource monitoring and graceful degradation: track memory, CPU and DB write latency; if ingestion slows, reduce concurrency, lower batch sizes, or pause new downloads. Surface health and throttling state to the dashboard so admins can act.

- Example metrics to track: `rows_per_second`, `bytes_in_flight`, `avg_insert_ms`, `open_file_streams`, `job_queue_length`.

Mapping to existing repo flow:
- `fetcher.send()` (POST to `fetch_list2.php`) remains the entry point for discovering available files.
- Replace `download_file()` + local file write with `streamAndIngest()` that streams the remote file directly into MongoDB and emits progress events.
- The role of `Combiner.generate()` is preserved but can be adapted to run on DB data (preferred) or triggered after a date's files finish ingesting.

With these patterns the webapp provides near real-time feedback, keeps memory usage constant, and prevents the UI or other API endpoints from lagging while large historical imports run.


## MongoDB Schema (suggested)
- `reports` collection: one document per CSV row with fields similar to original CSV (POS, OR, ITEM_CODE, DATE, TIME, AMOUNT, QUANTITY, BRANCH, POS_NUM, etc.). Add metadata fields: `sourceFile`, `fetchJobId`, `ingestedAt`.
- `fetch_logs` collection: { jobId, startDate, endDate, mode, branch, pos, status, startTime, endTime, rowsInserted, errors: [] }
- `branches` collection: branch list used by server (loaded from settings/branches.txt or UI).

Indexes:
- `reports` — index on `{ BRANCH:1, DATE:1, POS:1 }` and on `{ fetchJobId:1 }`.

## Worker / Job Orchestration
- Implement a job runner that iterates over date range and branches/pos as the Python `fetcher` did.
- For each (branch, pos, date): call remote API to get file list (POST to `fetch_list2.php`), select the files (rd5000, etc.), stream-download and ingest.
- Persist partial progress to `fetch_logs` so jobs can resume if interrupted.
- Expose an endpoint to cancel a running job by ID.

## Dashboard (Next.js)
- Page: `pages/admin/fetcher.js` (protected by admin auth). UI elements:
  - Date range inputs
  - Buttons: `Start Fetch`, `Start Missing Fetch`
  - Live progress area (progress bar + log lines) connected to SSE endpoint `/api/fetch/status/stream?jobId=...`
  - Table view to query ingested `reports` with filters (branch, date range, product)

SSE client example (Next.js / React):

```js
useEffect(() => {
  const es = new EventSource('/api/fetch/status/stream')
  es.onmessage = (ev) => {
    const data = JSON.parse(ev.data)
    // update progress state
  }
  es.onerror = () => es.close()
  return () => es.close()
}, [])
```

Alternatively, use WebSocket if you already have socket infra.

## Handling 'missing' fetch
- Provide an admin UI that can upload or generate the `branches_missing` structure (matching the output of `missing_generate.py`).
- `POST /api/fetch/missing` accepts the structure and triggers only the requested (branch,pos,date) fetches.

## Transform & Normalization
- Implement the same normalization rules as `pandasbiggs.CSVProcessor`:
  - Unicode normalization (NFKD) and ASCII fallback
  - Convert numeric strings to Decimal/Number consistently
  - Parse `DATE` and `TIME` into JS `Date` and store ISO strings
  - Map / convert product names and branches using small reference collections in MongoDB (conversion tables can be imported from CSVs stored in repo)

Example transformRow outline:

```js
function transformRow(row, meta) {
  return {
    OR: row['OR'],
    BRANCH: row['BRANCH'],
    DATE: new Date(row['DATE']),
    TIME: row['TIME'],
    QUANTITY: Number(row['QUANTITY'] || 0),
    AMOUNT: Number(row['AMOUNT'] || 0),
    PRODUCT_NAME: normalize(row['PRODUCT NAME']),
    sourceFile: meta.sourceFile,
    fetchJobId: meta.jobId,
    ingestedAt: new Date()
  }
}
```

## Error handling and retries
- Retry file downloads up to 3 times with exponential backoff.
- On malformed CSV rows, log and continue (store row in `fetch_logs.errors` for review).
- If a whole file fails repeatedly, mark that file in `fetch_logs` and proceed to next.

## Deployment & Run (dev)
1. Install server dependencies: `npm install express axios split2 csv-parse mongodb`
2. Start MongoDB (local or Atlas)
3. Start Express server: `node server/index.js` (or via PM2 for production)
4. Start Next.js frontend: `npm run dev` in the Next app

## Next Steps / Implementation Tasks
- Implement Express route `POST /api/fetch/start` and the streaming ingestion worker.
- Add `GET /api/fetch/status/stream` SSE endpoint and wire `EventEmitter` progress events.
- Build Next.js admin page to start jobs and visualize SSE progress.
- Import conversion CSVs into MongoDB collections and reuse them for normalization.

---
If you'd like, I can scaffold the Express route and a streaming worker file, plus the Next.js SSE client component next. Which part should I implement first?
