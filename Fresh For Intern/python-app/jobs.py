import os
import shutil
import datetime
import logging
import boto3
import requests
from pymongo import MongoClient
from subprocess import run
from urllib.parse import urljoin

logging.basicConfig(level=logging.INFO)

MONGO_URI = os.getenv('MONGO_URI', 'mongodb://mongo:27017/biggs')
RAW_STORAGE_PATH = os.getenv('RAW_STORAGE_PATH', './latest')
S3_BUCKET = os.getenv('AWS_S3_BUCKET')
S3_PREFIX = os.getenv('RAW_STORAGE_S3_PREFIX', '')
PYTHON_CMD = os.getenv('PYTHON_CMD', 'python')

mongo = MongoClient(MONGO_URI)
db = mongo.get_default_database()

s3_client = None
if S3_BUCKET:
    s3_client = boto3.client('s3')

# Helper: streaming download
def stream_download(remote_path, dest_path):
    url = urljoin('https://biggsph.com/biggsinc_loyalty/controller/', remote_path)
    headers = {'User-Agent': 'fetcher/1.0'}
    logging.info(f"Downloading {url} -> {dest_path}")
    with requests.get(url, stream=True, headers=headers, timeout=60) as r:
        r.raise_for_status()
        with open(dest_path, 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)

def upload_to_s3(local_path, s3_key):
    if not s3_client:
        raise RuntimeError('S3 client not configured')
    s3_client.upload_file(local_path, S3_BUCKET, s3_key)
    return f's3://{S3_BUCKET}/{s3_key}'

# Map parsed combiner row to transaction document (basic mapping)
def map_parsed_row_to_doc(fields):
    # Assuming combiner output ordering; adapt as needed
    # Minimal example: date,time,productName,quantity,amount,branch,pos,paymentName
    return {
        'date': fields[8] if len(fields) > 8 else None,
        'time': fields[9] if len(fields) > 9 else None,
        'productCode': fields[2] if len(fields) > 2 else None,
        'productName': fields[18] if len(fields) > 18 else None,
        'quantity': int(fields[4]) if len(fields) > 4 and fields[4].isdigit() else 0,
        'amount': float(fields[6]) if len(fields) > 6 and fields[6] != '' else 0.0,
        'branch': fields[-1] if len(fields) > 0 else None,
        'pos': None,
        'paymentName': fields[-3] if len(fields) > 0 else None,
        'createdAt': datetime.datetime.utcnow()
    }

# Main job function invoked by RQ
def fetch_branch_pos_date(branch, pos, date):
    job_tmp = f"/app/temp_job_{branch}_{pos}_{date}".replace(':','_')
    latest_dir = os.path.join(job_tmp, 'latest')
    os.makedirs(latest_dir, exist_ok=True)

    try:
        # 1) request list
        list_resp = requests.post('https://biggsph.com/biggsinc_loyalty/controller/fetch_list2.php', data={'branch':branch,'pos':pos,'date':date}, timeout=30)
        if '<!doctype' in list_resp.text:
            logging.error('Remote returned HTML, aborting')
            db.monitor.insert_one({'branch':branch,'pos':pos,'date':date,'note':'html_response','createdAt':datetime.datetime.utcnow()})
            return
        files = [f for f in list_resp.text.split(',') if f]

        # 2) download files streaming
        for f in files:
            fname = os.path.basename(f)
            dest = os.path.join(latest_dir, fname)
            try:
                stream_download(f, dest)
                # record filerecord doc
                filerec = {
                    'filename': fname,
                    'branch': branch,
                    'pos': pos,
                    'date': date,
                    'path': dest,
                    'status': 'raw',
                    'fetchedAt': datetime.datetime.utcnow()
                }
                if S3_BUCKET:
                    s3_key = os.path.join(S3_PREFIX, fname)
                    s3_key = s3_key.lstrip('/')
                    s3uri = upload_to_s3(dest, s3_key)
                    filerec['storage'] = {'provider':'s3','uri':s3uri}
                    # optionally remove local file
                    os.remove(dest)
                db.filerecords.insert_one(filerec)
            except Exception as e:
                logging.exception('Download failed for %s', f)
                db.monitor.insert_one({'branch':branch,'pos':pos,'date':date,'note':f'download_failed:{f}','error':str(e),'createdAt':datetime.datetime.utcnow()})

        # 3) run combiner_runner.py which will run Combiner over latest_dir
        parsed_out = os.path.join(job_tmp, 'parsed.csv')
        cmd = [PYTHON_CMD, 'combiner_runner.py', '--workdir', latest_dir, '--out', parsed_out]
        logging.info('Running combiner: %s', ' '.join(cmd))
        result = run(cmd)
        if result.returncode != 0:
            logging.error('Combiner failed')
            db.monitor.insert_one({'branch':branch,'pos':pos,'date':date,'note':'combiner_failed','createdAt':datetime.datetime.utcnow()})
            return

        # 4) stream parsed CSV into Mongo in batches
        if os.path.exists(parsed_out):
            batch = []
            with open(parsed_out, 'r', encoding='utf-8') as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    # skip header if present
                    if line.lower().startswith('pos') or line.lower().startswith('or'):
                        continue
                    fields = line.split(',')
                    doc = map_parsed_row_to_doc(fields)
                    batch.append(doc)
                    if len(batch) >= 1000:
                        db.transactions.insert_many(batch, ordered=False)
                        batch = []
                if batch:
                    db.transactions.insert_many(batch, ordered=False)

            db.filerecords.update_many({'branch':branch,'pos':pos,'date':date},{'$set':{'status':'parsed'}})

    finally:
        shutil.rmtree(job_tmp, ignore_errors=True)
