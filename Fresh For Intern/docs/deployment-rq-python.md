# Python Deployment: Redis (RQ) + MongoDB + Streaming Downloads

This document shows how to deploy the existing Python pipeline (`fetcher.py`, `combiner.py`) using a Redis-backed queue (RQ), streaming downloads, and MongoDB for master data. It focuses on a Python-only stack (no Node/BullMQ) and keeps integration minimal so you can reuse the current code.

---

## Goals
- Run fetch jobs (range / missing) through a fast background queue using Redis + RQ.
- Use streaming downloads (requests stream) to avoid large memory usage.
- Save raw CSVs to storage (local GridFS or S3) and write metadata to MongoDB.
- Run the existing `Combiner` to normalize rows, then stream parsed rows into Mongo.
- Provide a small API (Flask or FastAPI) to enqueue jobs and query progress.

## High-level architecture
- API server (Flask/FastAPI) — enqueue jobs and query status.
- Redis — job queue for RQ.
- Worker(s) — RQ workers pick jobs and run Python tasks (download, combine, import).
- MongoDB — store `FileRecord` metadata, `Transaction` master documents, and `MonitorEntry`.

Flow per job
1. API receives a request (single job or `branches_missing` map) and enqueues tasks into RQ.
2. Worker pulls a job, calls remote `fetch_list2.php` to list files, downloads each file using streaming, saves raw file (GridFS or local), and creates `FileRecord` in Mongo.
3. Worker runs a `combiner_runner.py` wrapper that points `Combiner` at the job's working `latest/` folder and produces a parsed CSV for that job.
4. Worker reads parsed CSV line-by-line and bulk-inserts `Transaction` documents into Mongo (use batched inserts to reduce memory pressure).
5. Worker updates `FileRecord` statuses and enqueues any follow-up monitoring entries.

## Docker Compose (dev) — Python + Redis + Mongo
Create `docker-compose.yml` (dev) in project root:

```yaml
version: '3.8'
services:
  mongo:
    image: mongo:6
    ports: ['27017:27017']
    volumes:
      - mongo-data:/data/db

  redis:
    image: redis:7
    ports: ['6379:6379']

  app:
    build: ./python-app
    command: uvicorn api:app --host 0.0.0.0 --port 8000
    environment:
      - MONGO_URI=mongodb://mongo:27017/biggs
      - REDIS_URL=redis://redis:6379
      - RAW_STORAGE_PATH=/app/latest
      - PYTHONUNBUFFERED=1
    ports:
      - '8000:8000'
    volumes:
      - ./:/app
    depends_on:
      - mongo
      - redis

  worker:
    build: ./python-app
    command: rq worker --url redis://redis:6379 default
    environment:
      - MONGO_URI=mongodb://mongo:27017/biggs
      - REDIS_URL=redis://redis:6379
      - RAW_STORAGE_PATH=/app/latest
    volumes:
      - ./:/app
    depends_on:
      - mongo
      - redis

volumes:
  mongo-data:
```

Notes: `./python-app` contains the Flask/FastAPI API, RQ task definitions, `combiner_runner.py`, and worker helper modules.

## Minimal requirements (requirements.txt)
```
fastapi
uvicorn[standard]
requests
pymongo
rq
redis
python-dotenv
pandas
tqdm
```

## API: enqueue jobs (FastAPI example)
Create a lightweight API to accept `branches_missing` and enqueue RQ jobs.

```py
# api.py (FastAPI)
from fastapi import FastAPI
from pydantic import BaseModel
from rq import Queue
from redis import Redis
from jobs import fetch_branch_pos_date

app = FastAPI()
redis_conn = Redis.from_url("redis://redis:6379")
q = Queue('default', connection=redis_conn)

class BranchesMissing(BaseModel):
    branches_missing: dict

@app.post('/fetch/missing')
async def enqueue_missing(payload: BranchesMissing):
    for branch, pos_map in payload.branches_missing.items():
        for pos_str, dates in pos_map.items():
            pos = int(pos_str)
            for d in dates:
                q.enqueue(fetch_branch_pos_date, branch, pos, d)
    return {"status":"enqueued"}


```

## RQ job: streaming download + combiner runner
Create `jobs.py` containing the worker task function. Key points:
- Use `requests.get(..., stream=True)` and write chunks to file to avoid loading entire file into memory.
- Save raw file to `RAW_STORAGE_PATH` or upload to GridFS.
- Use a unique job temp folder for `latest/` per job (e.g., `/tmp/latest_job_<jobid>`).

Example `jobs.py` (simplified):

```py
import os
import shutil
import requests
from pymongo import MongoClient
from subprocess import run

MONGO = MongoClient(os.getenv('MONGO_URI'))
DB = MONGO.get_database()

def stream_download(url, dest_path):
    headers = {'User-Agent': 'fetcher/1.0'}
    with requests.get(url, stream=True, headers=headers, timeout=60) as r:
        r.raise_for_status()
        with open(dest_path, 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)

def fetch_branch_pos_date(branch, pos, date):
    job_tmp = f"/app/temp_job_{branch}_{pos}_{date}"  # ensure unique
    latest_dir = os.path.join(job_tmp, 'latest')
    os.makedirs(latest_dir, exist_ok=True)

    try:
        # 1) POST to fetch_list2.php to get filenames
        list_resp = requests.post('https://biggsph.com/biggsinc_loyalty/controller/fetch_list2.php', data={'branch':branch,'pos':pos,'date':date}, timeout=30)
        if '<!doctype' in list_resp.text:
            # remote returned HTML → error; create MonitorEntry and return
            DB.monitor.insert_one({'branch':branch,'pos':pos,'date':date,'note':'html_response','createdAt':datetime.datetime.utcnow()})
            return
        files = [f for f in list_resp.text.split(',') if f]

        # 2) download each file streaming into latest_dir
        for f in files:
            url = 'https://biggsph.com/biggsinc_loyalty/controller/' + f
            dest = os.path.join(latest_dir, os.path.basename(f))
            stream_download(url, dest)
            # record FileRecord
            DB.filerecords.insert_one({'filename':os.path.basename(f),'branch':branch,'pos':pos,'date':date,'path':dest,'status':'raw','fetchedAt':datetime.datetime.utcnow()})

        # 3) run combiner_runner to read latest_dir and produce parsed CSV
        # combiner_runner should accept --workdir argument so Combiner reads from latest_dir
        result = run(["python","combiner_runner.py","--workdir", latest_dir, "--out", os.path.join(job_tmp,'parsed.csv')], check=False)
        if result.returncode != 0:
            DB.monitor.insert_one({'branch':branch,'pos':pos,'date':date,'note':'combiner_failed','createdAt':datetime.datetime.utcnow()})
            return

        # 4) stream parsed CSV and insert into Mongo in batches
        parsed_path = os.path.join(job_tmp,'parsed.csv')
        with open(parsed_path, 'r', encoding='utf-8') as fh:
            batch = []
            for line in fh:
                # assume CSV row simple split, or use csv.DictReader for header mapping
                fields = line.strip().split(',')
                doc = map_parsed_row_to_doc(fields, branch, pos, date)
                batch.append(doc)
                if len(batch) >= 1000:
                    DB.transactions.insert_many(batch, ordered=False)
                    batch = []
            if batch:
                DB.transactions.insert_many(batch, ordered=False)

        # 5) update filerecords status
        DB.filerecords.update_many({'branch':branch,'pos':pos,'date':date},{'$set':{'status':'parsed'}})

    finally:
        # cleanup
        shutil.rmtree(job_tmp, ignore_errors=True)


```

Notes: `map_parsed_row_to_doc` must map the Combiner output columns to your schema. Use `csv` module if rows contain quoted commas.

## combiner_runner.py (wrapper)
- Add a small wrapper that sets working directory or passes `latest` path to `Combiner`. If `Combiner` cannot accept a workdir parameter, the wrapper can `chdir` to the job's `latest` path and call `Combiner.generate()`.

Example (skeleton):

```py
import argparse
import os
import sys
from combiner import Combiner

parser = argparse.ArgumentParser()
parser.add_argument('--workdir')
parser.add_argument('--out', default='parsed.csv')
args = parser.parse_args()

orig_cwd = os.getcwd()
try:
    # set working latest dir by symlink or chdir
    os.chdir(args.workdir)
    comb = Combiner()
    comb.generate()
    # Combiner writes record2025.csv in repo root; copy only relevant rows to args.out
    # (Implement a small filter to extract only rows for this branch/pos/date)
finally:
    os.chdir(orig_cwd)

```

## Monitoring and dashboard
- Use `rq-dashboard` for RQ queue monitoring during development: `pip install rq-dashboard` and run `rq-dashboard --redis-url redis://redis:6379`.

## Production considerations
- Use S3 for raw file storage in production; upload streaming chunks to S3 multipart or write to temporary local file and upload.
- Use TLS for API and secure Redis/Mongo (auth and network rules).
- Add retries with exponential backoff for download failures and for remote HTML responses.

## Quick start (local)
1. Create `python-app` folder with `api.py`, `jobs.py`, `combiner_runner.py`, and `requirements.txt`.
2. Build and run with Docker Compose:

```bash
docker-compose up --build
```

3. Enqueue a job (example using `curl`):

```bash
curl -X POST http://localhost:8000/fetch/missing -H 'Content-Type: application/json' -d '{"branches_missing": {"SMNAG": {"1": ["2025-08-15"]}}}'
```

## Questions for you (quick)
1. Where do you want raw files stored in production: `s3` or `gridfs` or `local`?
2. Should I modify `Combiner` to accept a `workdir` param (recommended) or rely on `chdir`/temp folders in the wrapper?
3. Which parsed fields are essential for your webapp list view (pick up to 8): e.g., `date`, `time`, `branch`, `pos`, `productName`, `quantity`, `amount`, `paymentName`?

If you confirm these, I will scaffold the `python-app` folder (API, `jobs.py`, `combiner_runner.py`, `Dockerfile`, and `requirements.txt`) and a sample `.env.example`.
