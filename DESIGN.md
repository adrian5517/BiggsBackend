# System Design: Frontend & Backend

This document describes a proposed web application design for the existing fetcher/combiner ETL tools. It includes frontend pages and components, API contracts, data models, background-worker design, operational concerns, and deployment guidance.

## Goals

- Turn the fetch/process/combiner scripts into a reliable, observable web service.
- Provide operator UI for scheduling, ad-hoc fetch, missing-data detection, job monitoring, file inspection, and reprocessing.
- Make processing idempotent, auditable, and scalable.

## Tech stack (recommended)

- Backend API: FastAPI (Python)
- Worker: Celery (Redis broker) or RQ; tasks executed in separate containers
- Database: PostgreSQL (metadata, records optionally stored here or in partitioned CSVs)
- Object storage: S3 or MinIO for raw files and archives
- Frontend: React + TypeScript, UI library (MUI or AntD)
- Real-time: WebSocket (FastAPI + Redis pub/sub) for job updates
- Observability: Prometheus + Grafana, Sentry for errors
- CI/CD: GitHub Actions → Docker image → Deploy to Kubernetes or Docker Compose for small installs

## High-level architecture

- Web/API service: handles auth, job scheduling, job status, branch config, records query, uploads
- Background workers: download + parse + combine into `record2025` or DB; produce job events
- Storage: S3-like store for raw downloaded CSVs and parsed intermediate files
- DB: tracks jobs, branches, files, audit, metrics; optionally store processed records (denormalized) or write CSVs

## Data model (core tables)

- jobs
  - id (uuid), branch_id, pos (int), work_date (date), status (enum), file_list (json), chosen_files (json), attempt_count, created_by, created_at, started_at, finished_at, processor_version, error_message
- branches
  - id (text), name, is_new_branch (bool), parser_config (json), created_at
- files
  - id (uuid), job_id, branch_id, filename, filetype, s3_path, row_count, checksum, uploaded_at
- records (optional)
  - id, job_id, branch_id, pos, date, item_code, quantity, amount, tnsc, payment_method, other fields... (indexed by date/branch/pos)
- audit_logs
  - id, job_id, actor, action, detail, timestamp

Example SQL (Postgres):

```sql
CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  branch_id text NOT NULL,
  pos smallint NOT NULL,
  work_date date NOT NULL,
  status text NOT NULL,
  file_list jsonb,
  chosen_files jsonb,
  attempt_count int DEFAULT 0,
  processor_version text,
  created_at timestamptz DEFAULT now()
);
```

## API design (selected endpoints)

- Authentication: POST /api/auth/login -> { token }

- Jobs
  - POST /api/jobs/fetch
    - Request: { branch: string, pos: 1|2, date: "YYYY-MM-DD", force: bool }
    - Response: { job_id }
  - GET /api/jobs?branch=&status=&page=
    - Response: list of jobs with pagination
  - GET /api/jobs/{job_id}
    - Response: job details, chosen_files, logs (meta)
  - POST /api/jobs/{job_id}/retry
  - POST /api/jobs/{job_id}/cancel

- Missing
  - GET /api/missing?start=YYYY-MM-DD&end=YYYY-MM-DD
    - Response: { branch: { pos: [dates] } }
  - POST /api/missing/run
    - Request: { branches_missing: { ... } } -> queues jobs

- Branches
  - GET /api/branches
  - POST /api/branches (upsert)
  - POST /api/branches/{id}/test-parse (send sample file)

- Files
  - GET /api/files?job_id=&branch=
  - GET /api/files/{file_id}/download

- Records
  - GET /api/records?start=&end=&branch=&pos=&item=
  - GET /api/records/export?filters=...

Error handling and response codes
- 200 OK, 201 Created, 202 Accepted for queued operations
- 4xx for client errors; 5xx for server errors with Sentry capture

## Processing pipeline (detailed flow)

1. Client requests a fetch job (/api/jobs/fetch) or the missing-run endpoint creates multiple jobs.
2. API creates a `jobs` record with status=queued and pushes a task to Celery (payload: job_id, branch, pos, date).
3. Worker picks task: marks job running, calls remote `fetch_list2.php` and downloads files to temp storage.
4. Worker selects files per filetype (prefer largest row_count for that type) and stores raw files in S3 with metadata pushed to `files` table.
5. Worker runs parse/combiner (existing `Combiner.GenAppend` logic ported into modular parser functions) to produce processed rows.
6. Worker writes processed rows to `records` table (or partitioned CSV stored in S3) and updates job status success/failure, logs details.
7. Worker emits events over Redis pub/sub for WebSocket to notify clients of job progress.

Idempotency
- Use (branch,pos,date) uniqueness constraint on jobs; add `force=true` to reprocess. Ensure file writes are atomic (write to temp path then move/rename) and jobs are reconciled.

File selection rules
- For each filetype (rd5000, rd5500, etc.) choose the file with the highest row count; record reason in job.chosen_files.

Parsing rules & branch config
- Per-branch parser overrides (parser_config JSON) control column indices for item/dept, date/time parsing, and special cleaning.

Monitoring & alerts
- Metrics: job rate, job success/failure, fetch failures, missing-rate per branch.
- Set alerts for high failure rate or repeated missing data for a branch.

Security
- JWT-based authentication for API; role-based access control (admin/operator/viewer).
- Secure S3 credentials via secret manager; enforce HTTPS.
- Rate limiting on endpoints that call remote host.

Frontend design summary

- Framework: React + TypeScript
- State: React Query (server-state) + Context/Redux for auth & UI state
- Routes/pages: Dashboard, Jobs, Job Detail, Fetch Now, Missing Data, Branches, Files, Records, Settings, Login
- Real-time: WebSocket hook to subscribe to /ws/jobs and update job rows
- UX patterns: server-side pagination for large tables, preview modals for CSV rows, bulk-select & confirm modals for missing-run

Component contract examples

- `JobTable` props: { filters, page, pageSize, onAction } — calls GET /api/jobs
- `JobDetail` uses GET /api/jobs/{id}, subscribes to WS updates `jobs/{id}`
- `MissingDatesGrid` calls GET /api/missing and displays per-branch calendar heatmap; POST /api/missing/run to queue

Deployment (minimum viable)

- Docker Compose services: web (FastAPI + Uvicorn), worker (Celery), redis, postgres, minio, nginx (optional)
- Env vars (sample):
  - DATABASE_URL=postgresql://user:pass@db:5432/app
  - REDIS_URL=redis://redis:6379/0
  - S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY
  - SECRET_KEY (JWT), CELERY_BROKER_URL

Example docker-compose snippet (minimal):

```yaml
services:
  web:
    build: ./backend
    ports: ['8000:8000']
    env_file: .env
  worker:
    build: ./backend
    command: celery -A app.worker worker --loglevel=info
    env_file: .env
  redis:
    image: redis:7
  db:
    image: postgres:15
  minio:
    image: minio/minio
    command: server /data
```

CI/CD
- Build backend & frontend containers, run tests, push images, deploy to cluster. Use migrations (alembic) for DB schema changes.

Operational runbook (short)

- Starting: docker-compose up -d
- Check worker: `docker logs -f <worker>`; check jobs via UI
- Troubleshooting parse failures: job detail -> download raw files -> run parser locally with `Combiner` logic; re-run job (force)
- Backups: periodic snapshots of `record` storage and Postgres

Migration strategy

- Port parsing logic from `combiner.py` into isolated parser module with unit tests. Add test samples for edge cases (missing columns, different branch formats).

Next deliverables I can implement

- FastAPI skeleton with jobs endpoints and Celery tasks stubs.
- React starter with main pages and JobTable/JobDetail components wired to mocked API.
- DB schema (alembic) and docker-compose dev environment.

If you want me to scaffold any of these, tell me which: `fastapi`, `react`, or `docker-compose` and I'll generate the initial files.
