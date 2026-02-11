# Streaming Implementation — Developer Deliverable

Purpose
- Deliverable spec for webapp developers to implement streaming ingestion that reproduces the current Python `fetcher.py` + `combiner.py` workflow while keeping file naming and combiner compatibility (file types: `rd5000`, `rd5500`, `rd5800`, `rd5900`, `blpr`, `discount`, `rd1800`).

Delivery intent
- This doc is a hand-off: it explains required APIs, exact runtime behavior, constraints, how to run locally and in production, and acceptance tests the developer must pass.

Assumptions
- Admin login / auth is already implemented in the Next.js app.
- MongoDB is available (local or Atlas).
- `settings/branches.txt` and `settings/newBranches.txt` exist and can be read by the server or imported into DB.

Files the developer should produce
- `server/index.js` — Express server with endpoints below and SSE support.
- `server/streamWorker.js` — streaming worker that:
  - discovers files via `fetch_list2.php` (POST),
  - streams each CSV, parses rows, batches into `reports` collection,
  - tees raw bytes to `latest/` so existing `Combiner.generate()` can still operate unchanged,
  - emits `progress` and `error` events.
- `docs/streaming-implementation.md` — this file (hand-off).
- Optional: `server/combiner_runner.js` — small wrapper to run Python `Combiner.generate()` for a given date after ingestion completes.

Dependencies
- Node: `express`, `axios`, `csv-parse`, `mongodb`, (optional) `bullmq`, `ioredis` for queueing.

API Spec (required endpoints)
- POST /api/fetch/start
  - Body: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }
  - Response: { jobId: string }
  - Behaviour: enqueues a job which iterates dates from start→end and for every branch (from `settings/branches.txt`) and pos [1,2] streams files.
- POST /api/fetch/missing
  - Body: branches_missing JSON (see schema below).
  - Response: { jobId }
  - Behaviour: enqueues a job to stream exactly the requested (branch,pos,date) tuples.
- GET /api/fetch/status/stream?jobId=... (SSE)
  - Streams JSON events: { type: 'progress'|'error'|'done', jobId, branch?, pos?, date?, file?, rows?, message? }

branches_missing JSON schema (exact format used by `missing_generate.py`)
{
  "BRANCH_CODE": {
    "1": ["2025-08-15","2025-08-16"],
    "2": ["2025-08-15"]
  },
  "OTHER": { "1": ["2025-08-20"] }
}

Streaming worker behaviour (exact expectations)
- Discover: POST to `https://biggsph.com/biggsinc_loyalty/controller/fetch_list2.php` with form fields `branch`, `pos`, `date` to get comma-separated filenames.
- For each filename:
  - Request `https://biggsph.com/biggsinc_loyalty/controller/<filename>` as a stream.
  - Tee the bytes to:
    1. a CSV parser (`csv-parse` streaming mode) that yields rows to the ingest pipeline, and
    2. a file write into `latest/<filename>` so the Python `Combiner` can read the file later.
  - For parsed rows: transform minimally (normalize strings, numeric casts, parse DATE/TIME) and buffer into batches (recommended 500–2000 rows).
  - Use `insertMany(batch, { ordered: false })` to write to `reports` collection and catch duplicate-key errors.
  - After each successful batch write emit SSE `progress` with rows written and approximate throughput.
  - On repeated file errors (3 attempts) emit `error` and continue with next file.

Preserving `Combiner` compatibility
- Default: tee raw files to `latest/` and leave `Combiner.generate()` unchanged. This is the fastest path to production compatibility.
- Recommended longer-term: port `Combiner` logic to run on MongoDB `reports` + reference collections. That improves performance and removes disk I/O.

Idempotency & resume policy
- Create a unique index on a deterministic key (e.g., `{ OR:1, BRANCH:1, POS:1, TIME:1, ITEM_CODE:1 }`) to prevent duplicates; ingestion should ignore duplicate-key errors.
- Write `fetch_logs` documents per job with fields: { jobId, startDate, endDate, mode, branch, pos, currentDate, currentFile, rowsInserted, status, errors } and update after each batch.
- To resume, read `fetch_logs` for last `currentFile` and `rowsInserted` and skip rows already persisted.

Operational choices to avoid lag (no-lag design)
- Keep batch writes small and frequent so memory and write latency remain bounded.
- Limit parallel downloads (configurable worker concurrency, default 2–4).
- Respect backpressure: pause parsing/reading when DB write latency rises; implement a simple rate-limiter tied to `avg_insert_ms`.
- Offload heavy `Combiner` joins: run them after ingestion completes for a date or partition them as separate background jobs.

How to run locally (developer quickstart)
1. Install dependencies

```bash
cd server
npm init -y
npm install express axios csv-parse mongodb
```

2. Configure environment (example `export`/`.env`):

MONGO_URI=mongodb://localhost:27017
PORT=3000

3. Start server

```bash
node server/index.js
```

4. Start an admin browser pointing to Next.js UI and call `POST /api/fetch/start` with a small test date; subscribe to SSE.

Acceptance tests (must pass)
- Test 1: Mock `fetch_list2.php` to return a known CSV filename set. Start a job; verify `latest/` contains the files and `reports` collection contains rows.
- Test 2: Supply `branches_missing` JSON for specific date; verify only requested dates are fetched and ingested.
- Test 3: Kill the server mid-file and restart; verify job resumes from `fetch_logs` and does not produce duplicate rows.
- Test 4: Trigger `Combiner.generate()` (Python) while ingestion is happening; ensure Combiner reads `latest/` files and produces the same master CSV format as before.

Developer checklist (deliverable)
- [ ] `server/streamWorker.js` implemented and tested against sample CSVs.
- [ ] `server/index.js` routes implemented: `/api/fetch/start`, `/api/fetch/missing`, `/api/fetch/status/stream`.
- [ ] `latest/` teeing works — disk files are valid and match remote file bytes.
- [ ] `reports` schema and unique constraints created in MongoDB.
- [ ] `fetch_logs` written and updated after each batch.
- [ ] Documentation updated with run commands and env variables (this file).

If you want, I will now convert this hand-off into a clean README-style `docs/streaming-implementation.md` (this file) and scaffold the Next.js admin page that calls `POST /api/fetch/start` and subscribes to SSE. Which should I implement next?

