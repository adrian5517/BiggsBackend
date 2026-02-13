from fastapi import FastAPI
from pydantic import BaseModel
from redis import Redis
from rq import Queue
import os
from pymongo import MongoClient
from fastapi.responses import StreamingResponse
import csv
import io

mongo = MongoClient(os.getenv('MONGO_URI', 'mongodb://mongo:27017/biggs'))
db = mongo.get_default_database()

app = FastAPI()

redis_url = os.getenv('REDIS_URL', 'redis://redis:6379')
redis_conn = Redis.from_url(redis_url)
q = Queue(os.getenv('RQ_DEFAULT_QUEUE', 'default'), connection=redis_conn)

class BranchesMissing(BaseModel):
    branches_missing: dict

@app.post('/fetch/missing')
async def enqueue_missing(payload: BranchesMissing):
    for branch, pos_map in payload.branches_missing.items():
        for pos_str, dates in pos_map.items():
            pos = int(pos_str)
            for d in dates:
                q.enqueue('jobs.fetch_branch_pos_date', branch, pos, d)
    return {"status":"enqueued"}

@app.get('/health')
async def health():
    return {"status":"ok"}


@app.get('/transactions')
async def get_transactions(branch: str = None, date_from: str = None, date_to: str = None, page: int = 1, limit: int = 100, format: str = 'json'):
    query = {}
    if branch:
        query['branch'] = branch
    if date_from or date_to:
        query['date'] = {}
        if date_from:
            query['date']['$gte'] = date_from
        if date_to:
            query['date']['$lte'] = date_to

    skip = (page - 1) * limit
    cursor = db.transactions.find(query).skip(skip).limit(limit)

    if format == 'csv':
        # stream CSV
        def iter_csv():
            output = io.StringIO()
            writer = csv.writer(output)
            # header
            writer.writerow(['date','time','branch','pos','productName','quantity','amount','paymentName'])
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)
            for doc in cursor:
                writer.writerow([
                    doc.get('date',''),
                    doc.get('time',''),
                    doc.get('branch',''),
                    doc.get('pos',''),
                    doc.get('productName',''),
                    doc.get('quantity',''),
                    doc.get('amount',''),
                    doc.get('paymentName','')
                ])
                yield output.getvalue()
                output.seek(0)
                output.truncate(0)

        return StreamingResponse(iter_csv(), media_type='text/csv')
    else:
        results = list(cursor)
        # convert ObjectId to str and return
        for r in results:
            r['_id'] = str(r['_id'])
        return { 'page': page, 'limit': limit, 'results': results }
