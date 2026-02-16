require('dotenv').config();
const { Worker } = require('bullmq');
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');
const { getConnectionOptions } = require('../services/redis');

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const pgConn = process.env.PG_CONN || process.env.DATABASE_URL || null;

if (!pgConn) console.warn('No PG_CONN/DATABASE_URL found in env; worker will not write to Postgres by default');

const pgClient = pgConn ? new Client({ connectionString: pgConn }) : null;

async function processJob(job) {
  const { stagingPath, filename, originalName, mimeType, size, userId } = job.data;
  const meta = { jobId: job.id, attemptsMade: job.attemptsMade || 0, name: job.name };
  console.log(JSON.stringify({ level: 'info', msg: 'Processing upload job', meta: { ...meta, originalName, stagingPath } }));

  // Example: read small file, simulate processing, write metadata to Postgres
  try {
    const stat = fs.statSync(stagingPath);
    // Connect to PG lazily
    if (pgClient && pgClient._connected !== true) {
      await pgClient.connect(); pgClient._connected = true;
      console.log(JSON.stringify({ level: 'info', msg: 'Connected to Postgres for uploads' }));
    }

    if (pgClient) {
      await pgClient.query('INSERT INTO uploads(job_id, filename, original_name, mime_type, size, user_id, created_at) VALUES($1,$2,$3,$4,$5,$6,NOW())', [job.id, filename, originalName, mimeType, size, userId]);
    }

    // After processing, remove staging file
    try { fs.unlinkSync(stagingPath); } catch (e) { console.warn(JSON.stringify({ level: 'warn', msg: 'Could not remove staging file', stagingPath, err: e && e.message })); }

    return { processed: true };
  } catch (err) {
    // Structured error log and append to DLQ file for manual inspection
    const errMsg = err && err.message ? err.message : String(err);
    console.error(JSON.stringify({ level: 'error', msg: 'Job processing failed', meta, error: errMsg }));

    try {
      const dlqDir = path.join(__dirname, '..', 'tmp');
      fs.mkdirSync(dlqDir, { recursive: true });
      const dlqPath = path.join(dlqDir, 'failed_uploads.jsonl');
      const record = { time: new Date().toISOString(), job: meta, data: job.data, error: errMsg };
      fs.appendFileSync(dlqPath, JSON.stringify(record) + '\n');
      // Also persist DLQ to Postgres when available
      if (pgClient) {
        try {
          if (!pgClient._connected) {
            await pgClient.connect(); pgClient._connected = true;
            console.log(JSON.stringify({ level: 'info', msg: 'Connected to Postgres for DLQ persistence' }));
          }
          // Ensure table exists
          await pgClient.query(`CREATE TABLE IF NOT EXISTS failed_uploads (
            id SERIAL PRIMARY KEY,
            job_id TEXT,
            name TEXT,
            data JSONB,
            error TEXT,
            created_at TIMESTAMPTZ DEFAULT now()
          )`);
          await pgClient.query('INSERT INTO failed_uploads(job_id, name, data, error) VALUES($1,$2,$3,$4)', [meta.jobId, meta.name, record.data, errMsg]);
          console.log(JSON.stringify({ level: 'info', msg: 'DLQ persisted to Postgres', jobId: meta.jobId }));
        } catch (pgErr) {
          console.error(JSON.stringify({ level: 'error', msg: 'Failed to persist DLQ to Postgres', err: pgErr && pgErr.message ? pgErr.message : pgErr }));
        }
      }
    } catch (writeErr) {
      console.error(JSON.stringify({ level: 'error', msg: 'Failed to write DLQ record', err: writeErr && writeErr.message }));
    }

    throw err;
  }
}

const connection = getConnectionOptions();

const worker = new Worker('uploadQueue', async job => {
  return processJob(job);
}, { connection });

worker.on('completed', job => console.log(JSON.stringify({ level: 'info', msg: 'Job completed', jobId: job.id })));
worker.on('failed', (job, err) => {
  console.error(JSON.stringify({ level: 'error', msg: 'Job failed', jobId: job && job.id, error: err && err.message }));
});

process.on('SIGINT', async () => { try { await worker.close(); if (pgClient && pgClient._connected) await pgClient.end(); process.exit(0); } catch (e) { process.exit(1); } });

console.log('Worker started for uploadQueue');
