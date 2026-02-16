const { query } = require('../services/pg');

function rowToDoc(row) {
  if (!row) return null;
  const doc = Object.assign({}, row, { _id: row.id });
  return doc;
}

async function create(doc) {
  const sql = `INSERT INTO export_jobs(job_id, user_id, status, params, file_name, error, progress, created_at, updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`;
  const params = [
    doc.jobId,
    doc.userId || null,
    doc.status || 'pending',
    doc.params ? JSON.stringify(doc.params) : null,
    doc.fileName || null,
    doc.error || null,
    doc.progress || 0,
    doc.createdAt || new Date(),
    doc.updatedAt || new Date(),
  ];
  const res = await query(sql, params);
  return rowToDoc(res.rows[0]);
}

async function findById(id) {
  const res = await query('SELECT * FROM export_jobs WHERE id = $1 LIMIT 1', [id]);
  return rowToDoc(res.rows[0]);
}

async function findByJobId(jobId) {
  const res = await query('SELECT * FROM export_jobs WHERE job_id = $1 LIMIT 1', [jobId]);
  return rowToDoc(res.rows[0]);
}

async function updateById(id, updates) {
  const sets = [];
  const params = [];
  let idx = 1;
  for (const [k, v] of Object.entries(updates || {})) {
    if (k === 'params') {
      sets.push(`params = $${idx}`);
      params.push(v ? JSON.stringify(v) : null);
      idx++;
      continue;
    }
    if (k === 'jobId') {
      sets.push(`job_id = $${idx}`); params.push(v); idx++; continue;
    }
    if (k === 'fileName') { sets.push(`file_name = $${idx}`); params.push(v); idx++; continue; }
    sets.push(`${k} = $${idx}`); params.push(v); idx++;
  }
  if (!sets.length) return await findById(id);
  const sql = `UPDATE export_jobs SET ${sets.join(', ')}, updated_at = now() WHERE id = $${idx} RETURNING *`;
  params.push(id);
  const res = await query(sql, params);
  return rowToDoc(res.rows[0]);
}

async function findPendingAndClaim() {
  // Atomically find one pending job and mark it running
  const res = await query(`WITH c AS (
    SELECT id FROM export_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
  ) UPDATE export_jobs SET status = 'running', updated_at = now() WHERE id IN (SELECT id FROM c) RETURNING *`);
  if (!res.rows.length) return null;
  return rowToDoc(res.rows[0]);
}

module.exports = { create, findById, findByJobId, updateById, findPendingAndClaim };

