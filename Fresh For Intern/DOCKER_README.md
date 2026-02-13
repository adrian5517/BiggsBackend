# Docker quickstart

This project includes a minimal Docker Compose setup to run the FastAPI app and an RQ worker, plus Redis and Mongo for storage.

Prerequisites
- Docker and Docker Compose installed.

Setup

1. Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
# edit .env if necessary
```

2. Build and start services:

```bash
docker compose up --build -d
```

3. Open the API at http://localhost:8000

4. To watch worker logs:

```bash
docker compose logs -f worker
```

Notes
- The `python-app` folder mounts into the container so code changes are reflected immediately (development convenience). In production, consider removing the volume and building immutable images.
- The RQ worker is used by the FastAPI app to enqueue background jobs (it expects a function path like `jobs.fetch_branch_pos_date` to be importable inside the container).
