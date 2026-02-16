// Postgres-backed FetchLog model shim
const { query } = require('../services/pg');

async function create(doc) {
  const sql = `INSERT INTO fetch_logs(job_id, status, mode, start_date, end_date, branches, positions, rows_inserted, files_total, files_completed, errors, started_at, finished_at, created_at, updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (job_id) DO NOTHING RETURNING *`;
  const params = [
    doc.jobId,
    doc.status || 'queued',
    doc.mode || null,
    doc.startDate ? new Date(doc.startDate) : null,
    doc.endDate ? new Date(doc.endDate) : null,
    Array.isArray(doc.branches) ? doc.branches : (doc.branches || []),
    Array.isArray(doc.positions) ? doc.positions : (doc.positions || []),
    doc.rowsInserted || 0,
    doc.filesTotal || 0,
    doc.filesCompleted || 0,
    doc.errors || [],
    doc.startedAt || null,
    doc.finishedAt || null,
    doc.createdAt || new Date(),
    doc.updatedAt || new Date(),
  ];
  const res = await query(sql, params);
  return res.rows && res.rows[0] ? mapRow(res.rows[0]) : null;
}

async function findOne(filter) {
  if (filter && filter.jobId) {
    const res = await query('SELECT * FROM fetch_logs WHERE job_id = $1 LIMIT 1', [filter.jobId]);
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }
  // basic fallback: return first row
  const res = await query('SELECT * FROM fetch_logs LIMIT 1');
  return res.rows[0] ? mapRow(res.rows[0]) : null;
}

async function findOneAndUpdate(filter, update, options = {}) {
  const jobId = filter && filter.jobId ? filter.jobId : null;
  if (!jobId) throw new Error('findOneAndUpdate requires filter.jobId');

  // handle $push.errors
  if (update && update.$push && update.$push.errors) {
    const msg = update.$push.errors;
    await query('UPDATE fetch_logs SET errors = array_append(coalesce(errors, ARRAY[]::text[]), $1), updated_at = now() WHERE job_id = $2', [msg, jobId]);
    if (options.returnDocument === 'after') return (await findOne({ jobId }));
    return null;
  }

  // simple $set or plain object
  const setObj = update.$set ? update.$set : update;
  const allowed = ['status','mode','startDate','endDate','branches','positions','rowsInserted','filesTotal','filesCompleted','startedAt','finishedAt','createdAt','updatedAt'];
  const sets = [];
  const params = [];
  let idx = 1;
  for (const [k,v] of Object.entries(setObj || {})) {
    let col = k;
    if (k === 'rowsInserted') col = 'rows_inserted';
    if (k === 'filesTotal') col = 'files_total';
    if (k === 'filesCompleted') col = 'files_completed';
    if (k === 'startDate') col = 'start_date';
    if (k === 'endDate') col = 'end_date';
    if (k === 'startedAt') col = 'started_at';
    if (k === 'finishedAt') col = 'finished_at';
    if (k === 'updatedAt') col = 'updated_at';
    if (k === 'createdAt') col = 'created_at';
    params.push(v);
    sets.push(`${col} = $${idx}`);
    idx += 1;
  }

  if (sets.length) {
    const sql = `UPDATE fetch_logs SET ${sets.join(', ')}, updated_at = now() WHERE job_id = $${idx}`;
    params.push(jobId);
    await query(sql, params);
    if (options.returnDocument === 'after') return (await findOne({ jobId }));
    return null;
  }

  // upsert if requested
  if (options.upsert) {
    const doc = Object.assign({ jobId }, setObj || {});
    await create(doc);
    if (options.returnDocument === 'after') return (await findOne({ jobId }));
  }

  return null;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status,
    mode: row.mode,
    startDate: row.start_date,
    endDate: row.end_date,
    branches: row.branches,
    positions: row.positions,
    rowsInserted: row.rows_inserted,
    filesTotal: row.files_total,
    filesCompleted: row.files_completed,
    errors: row.errors,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { create, findOne, findOneAndUpdate };
