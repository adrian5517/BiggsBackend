// Postgres-backed FileRecord model shim
const { query, getClient } = require('../services/pg');

function rowToDoc(row) {
  if (!row) return null;
  const doc = Object.assign({}, row, { _id: row.id });
  doc.storage = { type: row.storage_type || null, path: row.storage_path || null };
  return doc;
}

async function findOne(filter) {
  // support filter by branch,pos,workDate,sourceFile,status
  if (filter && filter.branch && (filter.pos != null) && filter.workDate && filter.sourceFile) {
    const res = await query('SELECT * FROM file_records WHERE branch = $1 AND pos = $2 AND work_date = $3 AND source_file = $4 LIMIT 1', [filter.branch, String(filter.pos), filter.workDate ? new Date(filter.workDate) : null, filter.sourceFile]);
    return rowToDoc(res.rows[0]);
  }
  // support lookup by _id
  if (filter && filter._id) {
    const res = await query('SELECT * FROM file_records WHERE id = $1 LIMIT 1', [filter._id]);
    return rowToDoc(res.rows[0]);
  }
  return null;
}

async function findById(id) {
  const res = await query('SELECT * FROM file_records WHERE id = $1 LIMIT 1', [id]);
  return rowToDoc(res.rows[0]);
}

async function create(doc) {
  const sql = `INSERT INTO file_records(filename, branch, pos, work_date, source_file, file_type, storage_type, storage_path, fetched_at, size, checksum, status, error, created_at, updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`;
  const params = [
    doc.filename,
    doc.branch || null,
    doc.pos != null ? String(doc.pos) : null,
    doc.workDate ? new Date(doc.workDate) : null,
    doc.sourceFile || null,
    doc.fileType || null,
    (doc.storage && doc.storage.type) || null,
    (doc.storage && doc.storage.path) || null,
    doc.fetchedAt || null,
    doc.size || null,
    doc.checksum || null,
    doc.status || null,
    doc.error || null,
    doc.createdAt || new Date(),
    doc.updatedAt || new Date(),
  ];
  const res = await query(sql, params);
  return rowToDoc(res.rows[0]);
}

async function findOneAndUpdate(filter, update, options = {}) {
  // support updates by _id or by unique key
  if (filter && filter._id) {
    // map update $set
    const setObj = update.$set ? update.$set : update;
    const sets = [];
    const params = [];
    let idx = 1;
    for (const [k,v] of Object.entries(setObj || {})) {
      let col = k;
      if (k === 'workDate') col = 'work_date';
      if (k === 'storage') {
        if (v.type) { sets.push(`storage_type = $${idx}`); params.push(v.type); idx++; }
        if (v.path) { sets.push(`storage_path = $${idx}`); params.push(v.path); idx++; }
        continue;
      }
      if (k === 'checksum') col = 'checksum';
      if (k === 'status') col = 'status';
      if (k === 'size') col = 'size';
      if (k === 'filename') col = 'filename';
      if (k === 'completedAt') col = 'completed_at';
      params.push(v);
      sets.push(`${col} = $${idx}`);
      idx++;
    }
    if (sets.length) {
      const sql = `UPDATE file_records SET ${sets.join(', ')}, updated_at = now() WHERE id = $${idx} RETURNING *`;
      params.push(filter._id);
      const res = await query(sql, params);
      return rowToDoc(res.rows[0]);
    }
    return null;
  }

  if (filter && filter.branch && (filter.pos != null) && filter.workDate && filter.sourceFile) {
    // upsert by unique constraint
    const setObj = update.$set ? update.$set : update;
    const sql = `INSERT INTO file_records(filename, branch, pos, work_date, source_file, file_type, storage_type, storage_path, fetched_at, size, checksum, status, error, created_at, updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (branch,pos,work_date,source_file) DO UPDATE SET
        filename = EXCLUDED.filename,
        file_type = EXCLUDED.file_type,
        storage_type = EXCLUDED.storage_type,
        storage_path = EXCLUDED.storage_path,
        fetched_at = EXCLUDED.fetched_at,
        size = EXCLUDED.size,
        checksum = EXCLUDED.checksum,
        status = EXCLUDED.status,
        error = EXCLUDED.error,
        updated_at = now()
      RETURNING *`;
    const params = [
      setObj.filename || null,
      filter.branch,
      String(filter.pos),
      filter.workDate ? new Date(filter.workDate) : null,
      filter.sourceFile,
      setObj.fileType || null,
      (setObj.storage && setObj.storage.type) || null,
      (setObj.storage && setObj.storage.path) || null,
      setObj.fetchedAt || null,
      setObj.size || null,
      setObj.checksum || null,
      setObj.status || null,
      setObj.error || null,
      setObj.createdAt || new Date(),
      setObj.updatedAt || new Date(),
    ];
    const res = await query(sql, params);
    return rowToDoc(res.rows[0]);
  }

  return null;
}

async function distinct(field) {
  if (field === 'branch') {
    const res = await query('SELECT DISTINCT branch FROM file_records WHERE branch IS NOT NULL');
    return res.rows.map(r => r.branch).filter(Boolean);
  }
  return [];
}

module.exports = { findOne, create, findOneAndUpdate, distinct };
