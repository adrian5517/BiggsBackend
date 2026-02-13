const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const EventEmitter = require('events');
const jobBus = require('./jobBus');
const Report = require('../models/reportModel');

function normalize(value) {
  if (value == null) return '';
  return String(value).trim();
}

class CombinerWorker {
  async runJob(opts = {}) {
    const { jobId, workdir, outFile } = opts;
    const baseDir = workdir ? path.resolve(workdir) : path.join(process.cwd(), 'latest');
    jobBus.emit('progress', { jobId, type: 'started', message: `Combine job started, workdir=${baseDir}` });

    if (!fs.existsSync(baseDir)) {
      jobBus.emit('error', { jobId, message: `workdir not found: ${baseDir}` });
      return;
    }

    // read newBranches
    const newBranchesPath = path.join(process.cwd(), 'settings', 'newBranches.txt');
    const newBranches = fs.existsSync(newBranchesPath) ? fs.readFileSync(newBranchesPath, 'utf8').split(/\r?\n/).filter(Boolean) : [];

    // build posFilenames structure
    const posFilenames = {};
    for (const fname of fs.readdirSync(baseDir)) {
      const name = fname.replace(/\.csv$/i, '');
      const parts = name.split('_');
      if (parts.length < 5) continue;
      const branch = parts[1];
      const pos = parts[2];
      const filetype = parts[3];
      const date = parts[4];
      posFilenames[branch] = posFilenames[branch] || {};
      posFilenames[branch][pos] = posFilenames[branch][pos] || {};
      posFilenames[branch][pos][date] = posFilenames[branch][pos][date] || {};
      posFilenames[branch][pos][date][filetype] = path.join(baseDir, fname);
    }

    // iterate
    for (const [branch, posDict] of Object.entries(posFilenames)) {
      for (const [pos, dateDict] of Object.entries(posDict)) {
        for (const [date, fTypes] of Object.entries(dateDict)) {
          const rd5000Path = fTypes['rd5000'];
          if (!rd5000Path) continue;
          try {
            jobBus.emit('progress', { jobId, type: 'file-start', branch, pos, date, file: rd5000Path });

            // load lookups into memory (small files)
            const item_map = await loadLookup(fTypes['rd5500'], branch, newBranches);
            const dept_map = await loadSimpleMap(fTypes['rd1800']);
            const disc_map = await loadSimpleMap(fTypes['discount']);
            const tnsc_map = await loadTnscMap(fTypes['rd5800']);
            const paym_map = await loadSimpleMap(fTypes['rd5900']);
            const blpr_map = await loadBlprMap(fTypes['blpr']);

            // prepare outFile
            const out = outFile || path.join(process.cwd(), 'record2025.csv');
            if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
              // copy header if exists
              const headerFile = path.join(process.cwd(), 'aaa_headers.csv');
              if (fs.existsSync(headerFile)) fs.copyFileSync(headerFile, out);
            }

            // stream rd5000
            const insertedTotal = await streamRd5000AndInsert({ rd5000Path, branch, pos, date, item_map, dept_map, disc_map, tnsc_map, paym_map, blpr_map, out, jobId });
            jobBus.emit('file-complete', { jobId, branch, pos, date, rows: insertedTotal });
          } catch (err) {
            jobBus.emit('error', { jobId, message: err && err.message ? err.message : String(err) });
          }
        }
      }
    }

    jobBus.emit('complete', { jobId, message: 'Combine job complete' });
  }
}

async function loadLookup(filePath, branch, newBranches) {
  const map = {};
  if (!filePath || !fs.existsSync(filePath)) return map;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean).reverse();
  for (const row of lines) {
    const cols = row.split(',');
    const code = normalize(cols[0]);
    if (!code) continue;
    if (newBranches.includes(branch)) {
      if (cols.length > 12) map[code] = { item_name: normalize(cols[1]), department_code: normalize(cols[12]) };
      else if (cols.length > 3) map[code] = { item_name: normalize(cols[1]), department_code: normalize(cols[3]) };
      else map[code] = { item_name: normalize(cols[1]) };
    } else {
      if (cols.length >= 2) map[code] = { item_name: normalize(cols[1]) };
      else map[code] = { item_name: '' };
    }
  }
  return map;
}

async function loadSimpleMap(filePath) {
  const map = {};
  if (!filePath || !fs.existsSync(filePath)) return map;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean).reverse();
  for (const row of lines) {
    const cols = row.split(',');
    if (!cols[0]) continue;
    map[normalize(cols[0])] = cols.length >= 2 ? normalize(cols[1]) : '';
  }
  return map;
}

async function loadTnscMap(filePath) {
  const map = {};
  if (!filePath || !fs.existsSync(filePath)) return map;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean).reverse();
  for (const row of lines) {
    const cols = row.split(',');
    if (cols.length >= 21) {
      map[normalize(cols[20])] = normalize(cols[11]);
    }
  }
  return map;
}

async function loadBlprMap(filePath) {
  const map = {};
  if (!filePath || !fs.existsSync(filePath)) return map;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean).reverse();
  const re = /\"=\"\"(.+?)\"\"\"/;
  for (const row of lines) {
    const cols = row.split(',');
    if (cols.length > 3) {
      const keyCandidate = cols[3];
      if ((cols[1] || '').length === 11) {
        const m = re.exec(keyCandidate);
        if (m) map[m[1]] = normalize(cols[1]);
        else map[normalize(keyCandidate)] = normalize(cols[1]);
      }
    }
  }
  return map;
}

async function streamRd5000AndInsert(ctx) {
  const { rd5000Path, branch, pos, date, item_map, dept_map, disc_map, tnsc_map, paym_map, blpr_map, out, jobId } = ctx;
  return new Promise((resolve, reject) => {
    const batch = [];
    let totalInserted = 0;
    const batchSize = Number(process.env.POS_BATCH_SIZE) || 1000;
    const parser = fs.createReadStream(rd5000Path).pipe(parse({ relax_quotes: true, relax_column_count: true, skip_empty_lines: true, trim: true }));

    parser.on('data', async (row) => {
      try {
        const mapped = mapRow(row, { branch, pos, item_map, dept_map, disc_map, tnsc_map, paym_map, blpr_map });
        if (!mapped) return;
        // write to CSV out
        fs.appendFileSync(out, mapped + '\n');
        // prepare report doc
        const doc = {
          jobId,
          branch,
          pos: Number(pos),
          workDate: new Date(date),
          sourceFile: path.basename(rd5000Path),
          data: mapped,
          ingestedAt: new Date()
        };
        batch.push(doc);
        if (batch.length >= batchSize) {
          parser.pause();
          const toInsert = batch.splice(0, batch.length);
          try {
            const inserted = await safeInsertMany(toInsert);
            totalInserted += inserted;
            jobBus.emit('progress', { jobId, type: 'progress', branch, pos, date, batchRows: inserted, totalRows: totalInserted });
          } catch (e) {
            jobBus.emit('error', { jobId, message: e.message });
          }
          parser.resume();
        }
      } catch (e) {
        jobBus.emit('error', { jobId, message: e.message });
      }
    });

    parser.on('end', async () => {
      try {
        if (batch.length) {
          const inserted = await safeInsertMany(batch.splice(0, batch.length));
          totalInserted += inserted;
          jobBus.emit('progress', { jobId, type: 'progress', branch, pos, date, batchRows: inserted, totalRows: totalInserted });
        }
        resolve(totalInserted);
      } catch (e) {
        reject(e);
      }
    });

    parser.on('error', (err) => {
      reject(err);
    });
  });
}

function mapRow(row, ctx) {
  const { branch, pos, item_map, dept_map, disc_map, tnsc_map, paym_map, blpr_map } = ctx;
  // row is array; build y following Python columns indexes
  const columns = [0,2,4,5,6,7,8,11,12,13,18,21,31,32,34,35,36,37];
  const y = [];
  for (let i = 0; i < row.length; i++) {
    if (columns.includes(i)) {
      if (i === 12) {
        const parts = String(row[i] || '').split(' ');
        y.push(parts[0] || '');
      } else {
        y.push(String(row[i] || ''));
      }
    }
  }
  while (y.length <= 17) y.push('');
  y[0] = String(pos);
  // item lookup
  if (y[2] && item_map[y[2]]) {
    y.push('"' + (item_map[y[2]].item_name || '') + '"');
    if (item_map[y[2]].department_code) {
      y[7] = '"' + item_map[y[2]].department_code + '"';
    }
  } else {
    y.push('');
  }
  const raw = (y[7] || '').replace('="', '').replace('"', '').trim();
  const code = raw;
  if (code && dept_map[code]) y.push('"' + dept_map[code] + '"'); else y.push('');
  const discKey = String(y[10] || '');
  if (discKey && disc_map[discKey]) y.push('"' + disc_map[discKey] + '"'); else y.push('');
  const type_map = { 'D': 'Dine-In', 'T': 'Take-Out', 'C': 'Delivery' };
  if (y[11] && type_map[y[11]]) y.push('"' + type_map[y[11]] + '"'); else y.push('');
  const time_dict = ["GY","GY","GY","GY","GY","GY","Breakfast","Breakfast","Breakfast","Breakfast","Breakfast","Lunch","Lunch","Lunch","Lunch","PM Snack","PM Snack","PM Snack","PM Snack","Dinner","Dinner","Dinner","Dinner","GY","GY"];
  if (y[9] && y[9].length >= 2) {
    const hour = parseInt(y[9].slice(0,2)) || 0;
    y.push(time_dict[hour] || 'No Time Record');
  } else {
    y.push('No Time Record');
  }
  // tnsc/paym/blpr
  if (y[17]) {
    if (tnsc_map[y[17]]) {
      y.push(tnsc_map[y[17]]);
      if (paym_map[tnsc_map[y[17]]]) y.push(paym_map[tnsc_map[y[17]]]); else y.push('');
    } else {
      y.push(''); y.push('');
    }
    if (blpr_map[y[17]]) { y.push(blpr_map[y[17]]); } else { y.push(''); }
  } else {
    y.push(''); y.push(''); y.push('');
  }
  y.push(String(branch));
  return y.join(',');
}

async function safeInsertMany(batch) {
  if (!batch || !batch.length) return 0;
  try {
    const inserted = await Report.insertMany(batch, { ordered: false });
    return Array.isArray(inserted) ? inserted.length : 0;
  } catch (error) {
    if (error && Array.isArray(error.writeErrors)) return Math.max(0, batch.length - error.writeErrors.length);
    return 0;
  }
}

module.exports = new CombinerWorker();
