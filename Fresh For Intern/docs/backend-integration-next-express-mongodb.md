# Backend Integration: Next.js (or Next API) + Express + MongoDB

This document describes how to integrate the existing Python fetcher/combiner workflow into a Next.js + Express + MongoDB backend focused on server-side, production-ready functionality. It covers architecture, API endpoints, MongoDB schema suggestions, worker/job design, auth and error-handling (including the 401 / refresh-token 500 problem), and example code snippets.

---

## Goals
- Run fetch operations (range or missing dates) against the remote controller endpoints used by `fetcher.Receive`.
- Store raw fetched files and parsed transactions in MongoDB (or external object storage + Mongo metadata).
- Provide secure endpoints to trigger fetch jobs, check status, and view results.
- Handle auth refresh failures and avoid unhandled 500s.

## High-level architecture
- Next.js app (optional front-end) + Express API server (or Next API routes) for backend endpoints.
- Job queue + worker process (BullMQ or similar) for long-running fetch + combine tasks.
- MongoDB for metadata and parsed transaction documents; GridFS or S3 for raw CSV storage.
- Optional: reuse existing Python `Combiner` by invoking Python worker, or port core combiner logic to Node.

## Key concepts mapped from `fetcher.py` / `combiner.py`
- The Python `Receive.send()` posts to `https://biggsph.com/.../fetch_list2.php` returning filenames for branch/pos/date.
- `download_file()` retrieves the CSVs and saves them to `latest/`.
- `process()` picks files and prepares them for `Combiner` which normalizes into `record2025.csv`.
- The new backend should replicate: (1) list remote files for branch/pos/date, (2) download raw files, (3) parse & normalize into transactions, (4) persist.

## Data model (MongoDB suggestions)
- Branch collection
  - _id: string (branch code)
  - name, metadata

- FileRecord
  - filename: string
  - branch: string
  - pos: number
  - date: Date
  - fileType: string (rd5000, rd5500, rd1800, blpr, discount, rd5800, rd5900)
  - storage: { type: 'gridfs'|'s3', path: string }
  - fetchedAt: Date
  - size: number
  - status: 'raw'|'parsed'|'error'
  - error?: string

- Transaction (parsed row from rd5000 normalized)
  - branch, pos, date, time, productCode, quantity, amount, department, paymentName, daypart, etc.
  - sourceFile: ObjectId -> FileRecord

- MonitorEntry (masterData_errorMonitoring.csv analog)
  - branch, pos, date, note, createdAt

Design note: store raw files in GridFS or S3 and keep metadata in `FileRecord` for fast queries.

## API design (Express)
- POST /api/fetch/range
  - Body: { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD', branches?: [string], runNow?: boolean }
  - Behavior: enqueue jobs per (branch,pos,date) or run inline for small ranges.

- POST /api/fetch/missing
  - Body: { branches_missing: { BRANCH: { 1: ['2025-08-15', ...], 2: [...] } } }
  - Behavior: enqueue worker tasks for only the missing combos (maps to `Receive.missing_fetch`).

- GET /api/fetch/status/:jobId
  - Returns job progress and errors.

- GET /api/records?branch=...&date=...
  - Returns parsed transactions for query.

## Worker responsibilities
- For each (branch,pos,date) job:
  1. POST to remote `fetch_list2.php` to get available filenames (same payload as Python: {branch,pos,date}).
  2. For each filename, download CSV content and store it to GridFS/S3; create `FileRecord` entry.
  3. If downloaded file is the main transaction file (rd5000) or referenced files needed for normalization, parse CSV and insert `Transaction` documents.
  4. Mark `FileRecord` status and create `MonitorEntry` for errors or empty datasets.

Retries: perform up to 3 retries with backoff on network errors. Record failure details to `MonitorEntry` and job logs.

## Auth and 401 / refresh-token 500 handling
- Problem summary: browser sees `401 Unauthorized` and then a call to `/api/auth/refresh-token` returned `500 Internal Server Error`.
- Root causes and fixes:
  - Ensure the refresh endpoint handles invalid tokens gracefully and returns `401` or `400` for invalid/expired refresh tokens instead of throwing server exceptions.
  - Implement robust try/catch on server-side and return JSON error body with code/message. Example: `res.status(401).json({error:'invalid_refresh'})`.
  - On the client, when a `401` occurs, call refresh endpoint and if it returns `401/400`, redirect to login; if it returns `500`, log and surface a clear message — but server should not return 500 for user errors.

Example Express refresh handler (pseudo-code):

```js
// Express route
app.post('/api/auth/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'missing_refresh' });
    const payload = verifyRefresh(refreshToken); // throws if invalid
    if (!payload) return res.status(401).json({ error: 'invalid_refresh' });
    const newAccess = signAccessToken({ sub: payload.sub });
    return res.json({ accessToken: newAccess });
  } catch (err) {
    console.error('refresh-token error', err);
    // Avoid leaking internals; return 500 only on server faults
    return res.status(500).json({ error: 'server_error' });
  }
});
```

Make sure `verifyRefresh` does not throw uncontrolled errors on expected cases (expired/unknown token). Use structured validation.

## Implementation choices
- Option A — Port everything to Node:
  - Pros: unified stack, easier to call from Express worker, no bridging.
  - Cons: requires re-implementing `Combiner` parsing/normalization.

- Option B — Run Python workers from Node (recommended for fast integration):
  - Use `child_process.spawn` to execute Python `missing_generate.py` or a new Python script that accepts JSON on stdin and writes results back or writes files that Node reads.
  - Keep data storage in Mongo: Python writes parsed CSVs to a temp location; Node reads them and loads into Mongo, or Python directly writes into Mongo using `pymongo`.

Recommendation: start with Option B for minimal change: wrap the existing Python fetcher/combiner as a worker callable from Node, and migrate to pure-Node later.

## Example Express worker flow (using Axios + BullMQ)

1) Enqueue job from `/api/fetch/missing`.

2) Worker handler (pseudo):

```js
const axios = require('axios');
const { spawn } = require('child_process');

async function doFetchFor(branch, pos, date) {
  // Step 1: list remote files
  const listResp = await axios.post('https://biggsph.com/biggsinc_loyalty/controller/fetch_list2.php', { branch, pos, date });
  // Step 2: for each file, download
  for (const fname of listResp.data.files) {
    const dl = await axios.post('https://biggsph.com/biggsinc_loyalty/controller/download.php', { filename: fname }, { responseType: 'stream' });
    // stream into GridFS or local tmp file
  }
  // Step 3: call python combiner if needed
  const py = spawn('python', ['scripts/run_combiner_worker.py', '--branch', branch, '--date', date]);
  // capture stdout/stderr and await exit
}
```

## Parsing & normalization
- If porting parsing to Node, use `csv-parse` or `papaparse` server-side, map column indices like `Combiner.stringifyAppend`, and produce normalized `Transaction` objects.
- Ensure consistent dtype conversion (dates, decimals) and timezone handling.

## Error logging & monitoring
- Store per-file and per-job errors in Mongo `MonitorEntry`.
- Add an admin endpoint `GET /api/monitor` to list recent errors and failed branch/pos/date combos.

## Operational notes
- Add environment variables for remote endpoint, credentials, storage options.
- Schedule fetch jobs with cron or external scheduler; use queue concurrency limits to avoid overloading remote server.
- Respect remote site rate limits and add jitter/backoff.

## Quick start example (dev)

1. Create Express server and Mongoose models for `FileRecord` and `Transaction`.
2. Implement `/api/fetch/missing` to accept the same `branches_missing` object generated by `missing_generate.py`.
3. Worker executes steps above and returns job id.

## Next steps for you
- Decide whether to keep Python `Combiner` (Option B) or port to Node (Option A).
- I can generate example Mongoose models and full Express routes and a BullMQ worker if you want — tell me which option you prefer.

---

File created as integration blueprint for migrating `fetcher.py` and `combiner.py` into a functional Next.js/Express/Mongo backend.
