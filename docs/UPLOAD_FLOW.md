Upload flow
===========

Endpoints
- `POST /api/upload` — multipart upload; saves files into `./latest/` and creates `FileRecord` entries. Expects the 7 CSV files (rd5000, rd5500, rd1800, discount, rd5800, rd5900, blpr). Field names are ignored; attach as `file` or multiple files.

Behavior
- Files are written to `latest/` using multer disk storage.
- A `FileRecord` document is created for each file with status `uploaded`.
- If `REDIS_URL` is configured, an import queue job is enqueued which triggers the import worker to process files in `latest/` (calls `processFolder`).
- If `REDIS_URL` is not configured, uploads still succeed but import jobs are not queued automatically; run `node scripts/run-worker-local.js` to process `latest/` manually.

Notes
- Ensure `.env` contains `MONGO_URI` and optionally `REDIS_URL`.
- Use `GET /api/status` to see recent files and queue counts.
- Use `GET /api/health` for a quick health check (mongo+redis presence).
