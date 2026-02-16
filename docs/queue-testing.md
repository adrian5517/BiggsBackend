Queue — Quick Manual Test & Notes

Pahapyaw (purpose)
- Mabilis na manual checklist para i-verify ang upload queue (BullMQ + Redis) at kung ano pa ang kulang.

Manual testing (pahapyaw)
- Start local services (set `REDIS_PASSWORD` first):
  - `$env:REDIS_PASSWORD = "YourPass"`
  - `docker compose -f docker-compose.redis.yml up -d`
- Ensure `REDIS_URL` is set for the shell that runs Node:
  - `$env:REDIS_URL = 'redis://:YourPass@localhost:6379/0'`
- Start scheduler (optional): `npm run start:scheduler`
- Start worker: `npm run worker`
- Enqueue a test job: `node scripts/test_bullmq_enqueue.js`
- Verify:
  - Worker logs show job processing/completion.
  - Redis: `redis-cli -a YourPass INFO memory` and `INFO stats` (watch `evicted_keys`).
  - Check `tmp/failed_uploads.jsonl` for DLQ entries.

Missing / TODO (short)
- Persist DLQ entries to durable store (Postgres or S3) instead of local tmp file.
- Add monitoring & alerts for Redis memory, `evicted_keys`, failover events.
- Use a managed Redis with `maxmemory-policy=noeviction`, TLS, AUTH, HA and backups.
- Frontend: wire upload UI to `POST /api/upload` and job status polling / SSE.

Why Docker / Redis / PostgreSQL?
- Docker: reproducible local services (Redis) so tests match infra; quick spin up/down.
- Redis: low-latency in-memory store used by BullMQ for queues and fast job state. MUST use `noeviction` for reliability — otherwise queued jobs can be evicted.
- Postgres: durable metadata and DLQ storage; keep large blobs out of Redis by storing binary payloads in S3 and only enqueue references.

Short safety tips
- Don’t store large payloads in Redis — move to S3 and enqueue references.
- Alert on `evicted_keys` and memory >75%.
- Keep an external DLQ (Postgres/S3) so job payloads survive Redis incidents.

If you want, I can: add DLQ-to-Postgres wiring, or add a short runbook for swapping to a managed Redis provider.
