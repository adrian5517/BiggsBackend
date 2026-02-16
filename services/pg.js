const { Pool } = require('pg');

const connectionString = process.env.PG_CONN || process.env.DATABASE_URL;
if (!connectionString) {
  console.warn('Warning: PG_CONN not set — Postgres operations will fail until configured.');
}

const pool = new Pool({ connectionString, max: Number(process.env.PG_MAX_POOL) || 10 });

async function query(text, params) {
  return pool.query(text, params);
}

async function getClient() {
  return pool.connect();
}

module.exports = { pool, query, getClient };
