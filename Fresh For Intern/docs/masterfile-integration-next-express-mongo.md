# Masterfile Integration: map `fetcher.py` + `combiner.py` → Next.js / Express / MongoDB

This concise guide explains how the existing Python fetch+combine pipeline (`fetcher.py` and `combiner.py`) becomes a backend service for a Next.js/Express webapp with MongoDB as the masterfile store. It includes schema suggestions, API surface, worker flow, and practical migration options.

---

**Summary of source behavior**
- `Receive.send()`: POSTs to remote controller to list filenames for (branch, pos, date).
- `Receive.download_file()` + `process()`: downloads available CSVs into `latest/`.
- `Combiner.generate()` scans files in `latest/`, groups by branch/pos/date, and calls `GenAppend()` to normalize `rd5000` rows using reference files (`rd5500`, `rd1800`, `discount`, `rd5800`, `rd5900`, `blpr`) and append into `record2025.csv`.
- Normalization details live in `Combiner.stringifyAppend()` (field mappings, lookups, daypart/time mapping, branch-specific parsing via `settings/newBranches.txt`).

**Goal for webapp**
- Persist normalized transactions into MongoDB so the Next.js frontend can query/filter/sort them, and keep raw file metadata for auditing and reprocessing.

Design choices (pick one)
- Option A — Port `Combiner` to Node.js: implement parsing & normalization in Node (single stack). Use `csv-parse`, `decimal.js`, `dayjs`.
- Option B — Keep Python as worker: call Python scripts from Node (child_process or a task queue). Python handles fetching & combining, then writes parsed output to Mongo (via `pymongo`) or saves parsed CSV for Node to import. (Recommended to start fast.)

Data model (suggested Mongoose schemas)
- FileRecord
  - filename: String
  - branch: String
  - pos: Number
  - date: Date
  - fileType: String
  - storage: { provider: String, path: String }
  - fetchedAt: Date
  - size: Number
  - status: String // 'raw'|'parsed'|'error'
  - error: String

- Transaction (master record)
  - branch: String (index)
  - pos: Number (index)
  - date: Date (index)
  - time: String
  - transactionNumber: String
  - productCode: String
  - productName: String
  - departmentCode: String
  - departmentName: String
  - category: String
  - quantity: Number
  - unitPrice: Decimal128
  - amount: Decimal128
  - paymentName: String
  - daypart: String
  - sourceFile: ObjectId -> FileRecord
  - createdAt: Date

Indexing: add compound index on { branch:1, date:1, pos:1 } and indexes on fields used for filtering (productCode, departmentName, category).

API endpoints (Express)
- POST `/api/fetch/range` — body { startDate, endDate, branches?:[], runNow?:boolean } — enqueue jobs per (branch,pos,date).
- POST `/api/fetch/missing` — body { branches_missing } — enqueue missing-only jobs (same shape produced by `missing_generate.py`).
- POST `/api/fetch/reprocess` — body { fileId } — re-run combine on a specific raw `FileRecord` (useful for debugging branch-specific parsing).
- GET `/api/master` — query params for pagination and filters (branch, dateFrom, dateTo, product, dept, page, limit).
- GET `/api/monitor` — list recent `FileRecord` errors and `MonitorEntry`s.

Worker flow (per job for branch/pos/date)
1. Call remote list endpoint (same payload as `Receive.send()`): get filenames.
2. Download files (retry up to 3 times). Store raw bytes in GridFS or S3; create `FileRecord` metadata.
3. If `rd5000` exists: parse it and reference other files (`rd5500`, `rd1800`, etc.) to normalize rows exactly like `stringifyAppend()`.
4. Insert normalized `Transaction` documents in bulk into Mongo.
5. Set `FileRecord.status='parsed'` or `'error'` and write `MonitorEntry` for empty/missing/corrupt combos.

Notes on parsing details to preserve
- Branch-specific column positions: `settings/newBranches.txt` affects how `rd5500` maps dept column vs older branches — preserve same conditional logic.
- CSV row splitting: current Python uses naive split(',') then index positions; Node port must replicate same logic or implement more robust CSV parsing with quoted fields.
- Daypart/time mapping: keep the same mapping arrays.

Auth & 401 / refresh-token 500 handling (brief)
- Ensure auth refresh endpoints return controlled 4xx for client issues and 5xx only for server faults. Client logic: on 401 try refresh; if refresh fails with 401/400 → force re-login; if 500 → surface monitored error.

Operational considerations
- Storage: GridFS for small-scale local storage; S3 for production (cheaper & durable). Keep `FileRecord` metadata in Mongo.
- Concurrency: use a queue (Bull/BullMQ) and set concurrency to avoid hammering remote server.

Minimal implementation plan (recommended)
1. Start with Option B: implement an Express route `/api/fetch/missing` that accepts `branches_missing` and enqueues a job.
2. Create a small Python wrapper script `scripts/worker_bridge.py` that accepts a JSON job and runs the existing `Receive.missing_fetch()` for those inputs and writes parsed CSV to a temp path or inserts into Mongo via `pymongo`.
3. After Python produces parsed CSV / writes to Mongo, expose `/api/master` that reads `Transaction` documents and supports sorting/pagination.

Questions for you (tell me choices / preferences)
- Do you prefer Option A (port to Node) or Option B (call Python worker)?
- Where should raw CSVs be stored: `GridFS` (Mongo) or `S3` (external)?
- Which 6–8 fields are essential to show in the webapp list view? (e.g., date, time, branch, pos, productName, quantity, amount)
- Authentication method for Express/Next.js (JWT with refresh tokens, session cookies, other)?
- Do you want server-side filtering/pagination and CSV export endpoints?

Next I can:
- generate Mongoose models + example Express routes and a sample worker bridge (Python call) — or
- scaffold a full Node port of the `Combiner` parsing logic.

Tell me which option you prefer and answer the 5 questions above and I'll implement the next step.
