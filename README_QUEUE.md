Quick queue & worker scaffold

Files added:
- `services/queue.js` - BullMQ queue + scheduler using `REDIS_URL`.
- `routes/upload.js` - `POST /api/upload` accepts `file` form field, stages to `tmp/uploads`, enqueues a job.
- `workers/processor.js` - basic worker that consumes `uploadQueue` and writes metadata to Postgres.
- `scripts/migrate_pg.js` - simple migration to create `uploads` table. Run with `npm run migrate:pg`.

Env vars used:
- `REDIS_URL` (default redis://127.0.0.1:6379)
- `PG_CONN` or `DATABASE_URL` (Postgres connection string)
- `UPLOAD_STAGING_DIR` optional path for staging uploads

Run locally:

```bash
npm install
npm run migrate:pg
node workers/processor.js
node server.js
```

This scaffold is minimal — replace staging with S3, add auth middleware, and expand job processing as needed.
