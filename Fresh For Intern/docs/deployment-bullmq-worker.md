# Deployment & Worker Guide — MongoDB API -> Redis -> BullMQ -> Worker

This document describes a deployable local/production architecture that takes the current Python `fetcher.py` + `combiner.py` pipeline and turns it into a fast, scalable system for the Next.js / Express / MongoDB webapp using Redis + BullMQ for job orchestration.

Contents
- Architecture overview
- Docker Compose (development) example
- Environment variables
- Express API responsibilities + snippets
- BullMQ job producer and worker design
- Worker implementation options (call Python combiner) and import flow
- Mongo schemas / GridFS notes
- Running locally and production notes
- Monitoring, error handling and auth guidance

---

## Architecture (summary)
- Express API server (Next.js can call API routes or a separate Express service).
- MongoDB (store master `Transaction` documents and `FileRecord` metadata).
- Redis (BullMQ backend for queues).
- Worker(s): Node.js BullMQ worker(s) that download remote files, store raw files, spawn Python combiner to generate normalized output, then import normalized rows into Mongo.
- Optional: separate Python worker that writes directly to Mongo using `pymongo` (alternative path).

Flow (per job):
1. Client/cron calls Express API endpoint to enqueue fetch job for (branch,pos,date) or missing set.
2. BullMQ stores job in Redis queue.
3. Worker takes job: calls remote `fetch_list2.php`, downloads files, stores raw files (GridFS or local), writes `FileRecord` metadata to Mongo.
4. Worker spawns Python combiner (existing code) configured to read `latest/` and produce `record2025.csv` or a parsed CSV for that job.
5. Worker reads parsed CSV, transforms rows to `Transaction` documents and bulk inserts into Mongo.
6. Worker marks job success/failure and updates `FileRecord` statuses and a `MonitorEntry` collection on errors.

## Docker Compose (development) example
Place this as `docker-compose.yml` for local testing (adjust images/tags as needed):

```yaml
version: '3.8'
services:
  mongo:
    image: mongo:6
    restart: unless-stopped
    ports:
      - '27017:27017'
    volumes:
      - mongo-data:/data/db

  redis:
    image: redis:7
    restart: unless-stopped
    ports:
      - '6379:6379'

  api:
    build: ./server
    restart: on-failure
    environment:
      - MONGO_URI=mongodb://mongo:27017/biggs
      - REDIS_URL=redis://redis:6379
    depends_on:
      - mongo
      - redis
    ports:
      - "3000:3000"

  worker:
    build: ./worker
    restart: on-failure
    environment:
      - MONGO_URI=mongodb://mongo:27017/biggs
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./:/app
    depends_on:
      - mongo
      - redis

volumes:
  mongo-data:
```

Notes: `./server` contains Express API; `./worker` contains the Node worker that processes BullMQ jobs and calls the Python combiner in the codebase.

## Environment variables (minimum)
- `MONGO_URI` — e.g. `mongodb://mongo:27017/biggs`
- `REDIS_URL` — e.g. `redis://redis:6379`
- `STORAGE` — `gridfs` or `local` or `s3` (controls where raw files go)
- `RAW_STORAGE_PATH` — local path for files when `local` selected (e.g., `/app/latest`)
- `PYTHON_CMD` — path to python executable used to run `combiner` (e.g., `python3`)
- `JOB_CONCURRENCY` — worker concurrency

## Express API responsibilities & example routes
- Validate requests and enqueue jobs for fetch ranges or missing items.
- Provide endpoints for querying `Transaction` documents (filtering, pagination), and for monitoring `FileRecord` errors.

Example minimal Express route (enqueue missing jobs):

```js
// server/routes/fetch.js
const express = require('express');
const { Queue } = require('bullmq');
const router = express.Router();

const connection = { connection: { host: process.env.REDIS_HOST || 'redis', port: 6379 } };
const fetchQueue = new Queue('fetch', connection);

router.post('/missing', async (req, res) => {
  const { branches_missing } = req.body;
  // branches_missing: { BRANCH: { 1: ['2025-08-15'], 2: [...] } }
  for (const [branch, posObj] of Object.entries(branches_missing)) {
    for (const [pos, dates] of Object.entries(posObj)) {
      for (const date of dates) {
        await fetchQueue.add('fetch-job', { branch, pos: Number(pos), date });
      }
    }
  }
  res.json({ enqueued: true });
});

module.exports = router;
```

## BullMQ worker design (Node)
- Worker responsibilities:
  - Pop a job for (branch,pos,date).
  - Call remote `fetch_list2.php` (replicate `Receive.send()`), parse returned list of filenames.
  - Download each file into configured `RAW_STORAGE_PATH` (retry 3x).
  - Save raw file metadata to Mongo `FileRecord`.
  - Run Python combiner script (spawn child process) that reads from `latest/` and writes out a single normalized CSV for the job.
  - Read normalized CSV and bulk insert transactions to Mongo `Transaction` collection.
  - Update `FileRecord` statuses and write `MonitorEntry` for any issues.

Example worker snippet (simplified):

```js
// worker/index.js
const { Worker } = require('bullmq');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const fetch = require('node-fetch');
const connection = { host: 'redis', port: 6379 };

mongoose.connect(process.env.MONGO_URI);

const worker = new Worker('fetch', async job => {
  const { branch, pos, date } = job.data;
  // 1) call remote list
  const listResp = await fetch('https://biggsph.com/biggsinc_loyalty/controller/fetch_list2.php', { method: 'POST', body: new URLSearchParams({ branch, pos, date }) });
  const text = await listResp.text();
  const files = text.includes('<!doctype') ? [] : text.split(',');

  // 2) download files -> save to RAW_STORAGE_PATH
  // (implement download logic, save and create FileRecord docs)

  // 3) spawn Python combiner (assumes combiner reads latest/ and writes parsed CSV)
  await new Promise((resolve, reject) => {
    const py = spawn(process.env.PYTHON_CMD || 'python', ['-u', 'combiner_runner.py', '--branch', branch, '--pos', pos, '--date', date]);
    py.stdout.on('data', d => console.log(d.toString()));
    py.stderr.on('data', d => console.error(d.toString()));
    py.on('exit', code => code === 0 ? resolve() : reject(new Error('combiner failed')));
  });

  // 4) read normalized CSV (e.g., latest/record_parsed_{branch}_{pos}_{date}.csv) and bulk insert to Mongo
  // 5) update FileRecord statuses and return
}, { connection });

worker.on('failed', (job, err) => {
  console.error('Job failed', job.id, err);
  // create MonitorEntry in Mongo
});

```

## Worker — calling Python combiner and importing
- Two integration patterns:
  1. Python combiner writes normalized CSV -> Node worker reads CSV and inserts to Mongo. (Simple to implement.)
  2. Python combiner uses `pymongo` to write parsed rows directly into Mongo (less data movement, but requires modifying Python). 

Recommendation: start with pattern (1) for minimal Python changes.

Example `combiner_runner.py` wrapper (Python) — responsibilities:
- Accept CLI args `--branch --pos --date` or a JSON job file.
- Set `latest/` to a unique working dir for the job (or the repo `latest`), run Combiner logic to produce parsed CSV with a stable filename.
- Exit 0 on success, >0 on error.

Node worker then reads that parsed CSV and imports data:

```js
const csv = require('csv-parse');
const fs = require('fs');
const transactions = [];
fs.createReadStream(parsedCsvPath).pipe(csv.parse({ columns: true })).on('data', row => transactions.push(mapRowToTransaction(row))).on('end', async () => {
  // bulk insert
  await TransactionModel.insertMany(transactions, { ordered: false });
});
```

## Mongo schemas (Mongoose) — quick outline

```js
const FileRecord = new Schema({
  filename: String,
  branch: String,
  pos: Number,
  date: Date,
  fileType: String,
  storage: { provider: String, path: String },
  fetchedAt: Date,
  size: Number,
  status: { type: String, enum: ['raw','parsed','error'], default: 'raw' },
  error: String
});

const Transaction = new Schema({
  branch: String,
  pos: Number,
  date: Date,
  time: String,
  transactionNumber: String,
  productCode: String,
  productName: String,
  departmentCode: String,
  departmentName: String,
  category: String,
  quantity: Number,
  unitPrice: mongoose.Types.Decimal128,
  amount: mongoose.Types.Decimal128,
  paymentName: String,
  daypart: String,
  sourceFile: { type: Schema.Types.ObjectId, ref: 'FileRecord' },
  createdAt: { type: Date, default: Date.now }
});

Transaction.index({ branch: 1, date: 1, pos: 1 });
```

## GridFS vs local vs S3
- Development: local `latest/` or GridFS
- Production: recommend S3 for raw file storage and keep `FileRecord` metadata in Mongo. Use presigned urls if needed.

## Running locally
1. Ensure you have Docker and Docker Compose.
2. Populate `settings/branches.txt` and `settings/newBranches.txt` in repo root.
3. Start stack:

```bash
docker-compose up --build
```

4. Start Node worker locally (if not containerized) and the API server.
5. Call Express endpoint to enqueue missing jobs or run manual fetch using `manual_fetch.py` for Python-only runs.

## Monitoring and observability
- Use Bull Board / Arena to inspect Bull queues.
- Create `MonitorEntry` collection in Mongo with fields (branch,pos,date,note,createdAt) and an admin endpoint `/api/monitor`.
- Log worker stdout/stderr to a central system (files, Docker logs, or a log aggregator).

## Error handling & auth notes
- Retry downloads x3 with exponential backoff.
- For remote `fetch_list2.php` HTML responses (indicates a failed call), mark as error and create `MonitorEntry`.
- For the `401 + refresh-token 500` issue: ensure refresh call returns structured 4xx on token problems. In worker/API, wrap auth calls in try/catch and surface useful logs.

## Security
- Store secrets via env vars or a secrets manager.
- If exposing admin endpoints, protect via JWT or session with role checks.

## Next steps I can implement for you
- Scaffold `server/` Express app with the `/api/fetch/missing` route and queue producer.
- Add `worker/` Node worker files that implement download + spawn combiner + import CSV.
- Add `combiner_runner.py` wrapper that generates a parsed CSV for a single job.
- Add Dockerfiles for `./server` and `./worker` and a sample `.env.example`.

Tell me which of the `Next steps` you want me to generate next and I will scaffold the code and Dockerfiles.
