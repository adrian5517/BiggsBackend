# Redis + Queue Workflow (Python Implementation Guide)

This document explains how to implement a background job workflow in Python using **Redis** and **RQ (Redis Queue)**.

> Recommended for: large CSV processing, report generation, email sending, heavy computations, and scalable backend systems.

---

# 1. Architecture Overview

```
Client → API (Flask/FastAPI) → Redis → Worker → Database
```

### Flow Explanation
1. Client sends request (e.g., upload CSV)
2. API creates a background job
3. Redis stores the job
4. Worker processes job
5. Database updated
6. Client notified (optional: WebSocket or polling)

---

# 2. Installation

Install Redis locally or on your server.

Ubuntu:
```
sudo apt install redis-server
```

Install Python dependencies:
```
pip install redis rq flask
```

---

# 3. Project Structure

```
project/
│
├── app.py              # API server
├── worker.py           # Worker process
├── tasks.py            # Background job logic
└── redis_config.py     # Redis connection setup
```

---

# 4. Redis Configuration (redis_config.py)

```python
from redis import Redis

redis_conn = Redis(host='localhost', port=6379)
```

---

# 5. Background Task Logic (tasks.py)

```python
import time


def process_large_csv(file_path):
    print(f"Processing {file_path}...")
    
    # Simulate heavy processing
    for i in range(5):
        time.sleep(2)
        print(f"Processing chunk {i}")
    
    print("Processing completed.")
    return "Done"
```

---

# 6. API Server (app.py)

```python
from flask import Flask, request, jsonify
from rq import Queue
from redis_config import redis_conn
from tasks import process_large_csv

app = Flask(__name__)
queue = Queue(connection=redis_conn)

@app.route('/upload', methods=['POST'])
def upload():
    file_path = request.json.get('file_path')

    job = queue.enqueue(process_large_csv, file_path)

    return jsonify({
        "message": "Processing started",
        "job_id": job.id
    })

if __name__ == '__main__':
    app.run(debug=True)
```

---

# 7. Worker Process (worker.py)

```python
from rq import Worker, Queue
from redis_config import redis_conn

listen = ['default']

if __name__ == '__main__':
    worker = Worker(listen, connection=redis_conn)
    worker.work()
```

Run worker in separate terminal:

```
python worker.py
```

---

# 8. Job Lifecycle

Job states:

- queued
- started
- finished
- failed

You can check status:

```python
from rq.job import Job
from redis_config import redis_conn

job = Job.fetch(job_id, connection=redis_conn)
print(job.get_status())
```

---

# 9. Production Setup (Recommended)

For business-level deployment:

- Run Redis on dedicated server
- Run multiple workers
- Use supervisor or systemd
- Use Nginx + Gunicorn for API

Example scalable setup:

```
Load Balancer
      ↓
2 API Servers
      ↓
Redis (Central)
      ↓
5 Worker Processes
```

---

# 10. Best Practices

✔ Stream large files instead of loading into memory
✔ Process data in batches
✔ Use retries for failed jobs
✔ Monitor Redis memory usage
✔ Separate API and Worker processes
✔ Secure Redis (bind 127.0.0.1 or use password)

---

# 11. When To Use This

Use Redis + RQ if:

- Processing large CSV files
- Generating reports
- Sending bulk emails
- Running AI/ML tasks
- Running scheduled jobs

Avoid if:

- Simple CRUD apps
- Very small personal scripts

---

# 12. Summary

Redis handles job storage.
RQ manages background execution.
Workers process heavy tasks.
API remains fast and responsive.

This architecture makes your Python backend scalable and production-ready.

