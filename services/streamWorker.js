const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
const axios = require('axios');
const { parse } = require('csv-parse');
const crypto = require('crypto');

const Report = require('../models/reportModel');
const ReportBackup = require('../models/reportBackupModel');
const FetchLog = require('../models/fetchLogModel');

function normalizeValue(value) {
  if (value == null) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return trimmed.normalize('NFKD');
  } catch (e) {
    return trimmed;
  }
}



function normalizeRow(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = normalizeValue(value);
  }
  return normalized;
}

function pickField(row, keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== '') return row[key];
  }
  return null;
}

function buildUniqueKey(row, meta) {
  const orValue = pickField(row, ['OR', 'Or', 'or', 'OR_NO', 'OR#']);
  const itemCode = pickField(row, ['ITEM_CODE', 'ITEM CODE', 'ITEM', 'ITEMCODE']);
  const timeValue = pickField(row, ['TIME', 'Time', 'TIME_IN', 'TIMEOUT']);
  if (!orValue || !itemCode || !timeValue || !meta.branch || meta.pos == null) return null;
  return [meta.branch, meta.pos, String(orValue).trim(), String(timeValue).trim(), String(itemCode).trim()].join('|');
}

async function safeInsertMany(batch) {
  try {
    const inserted = await Report.insertMany(batch, { ordered: false });
    return inserted.length;
  } catch (error) {
    if (error && error.result && typeof error.result.nInserted === 'number') {
      return error.result.nInserted;
    }
    if (error && Array.isArray(error.writeErrors)) {
      return Math.max(0, batch.length - error.writeErrors.length);
    }
    return 0;
  }
}

class StreamWorker extends EventEmitter {
  async ingestFile(url, meta) {
    const maxRetries = Number(process.env.POS_FILE_RETRIES) || 3;
    const writeLatest = process.env.POS_WRITE_LATEST !== 'false';
    // Directory to write downloaded CSVs. Organized as <downloadDir>/<branch>/<YYYY-MM-DD>/
    const downloadDir = process.env.POS_DOWNLOAD_DIR || process.env.POS_LATEST_DIR || 'latest';

    const FileRecord = require('../models/fileRecordModel');

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const sourceFileNormalized = String(meta.sourceFile || url);

        // dedupe strategy
        const strategy = (process.env.POS_DEDUPE_STRATEGY || 'skip').toLowerCase();

        // check for already completed record
        try {
          const existingCompleted = await FileRecord.findOne({ branch: meta.branch, pos: meta.pos, workDate: meta.workDate, sourceFile: sourceFileNormalized, status: 'completed' });
          if (existingCompleted && strategy !== 'replace') {
            this.emit('progress', { jobId: meta.jobId, fileUrl: url, message: 'skipped (already completed)' });
            return 0;
          }
        } catch (e) {
          // ignore lookup errors
        }

        // Attempt to claim the FileRecord (prevent duplicate downloads)
          try {
          const existing = await FileRecord.findOne({ branch: meta.branch, pos: meta.pos, workDate: meta.workDate, sourceFile: sourceFileNormalized });
          if (existing) {
            if (existing.status === 'completed' && strategy !== 'replace') {
              this.emit('progress', { jobId: meta.jobId, fileUrl: url, message: 'skipped (already completed)' });
              return 0;
            }
            if (existing.status === 'processing') {
              this.emit('progress', { jobId: meta.jobId, fileUrl: url, message: 'skipped (processing by another worker)' });
              return 0;
            }

            // If strategy=replace and file was completed, force-claim by setting status->processing
            if (existing.status === 'completed' && strategy === 'replace') {
              const forced = await FileRecord.findOneAndUpdate(
                { _id: existing._id },
                { $set: { status: 'processing', fetchedAt: new Date(), replacing: true } },
                { returnDocument: 'after' }
              );
              if (!forced) {
                this.emit('progress', { jobId: meta.jobId, fileUrl: url, message: 'skipped (unable to force-claim for replace)' });
                return 0;
              }
            } else {
              // Atomically claim by switching status to processing if current status is neither processing nor completed
              const claimed = await FileRecord.findOneAndUpdate(
                { _id: existing._id, status: { $nin: ['processing', 'completed'] } },
                { $set: { status: 'processing', fetchedAt: new Date() } },
                { returnDocument: 'after' }
              );
              if (!claimed) {
                this.emit('progress', { jobId: meta.jobId, fileUrl: url, message: 'skipped (unable to claim)' });
                return 0;
              }
              // claimed; proceed
            }
          } else {
            // create a processing record as a claim
            try {
              await FileRecord.create({ branch: meta.branch, pos: meta.pos, workDate: meta.workDate, sourceFile: sourceFileNormalized, status: 'processing', fetchedAt: new Date() });
            } catch (e) {
              // race: another worker created it concurrently; re-query
              const raced = await FileRecord.findOne({ branch: meta.branch, pos: meta.pos, workDate: meta.workDate, sourceFile: sourceFileNormalized });
              if (raced) {
                if (raced.status === 'completed' && strategy !== 'replace') {
                  this.emit('progress', { jobId: meta.jobId, fileUrl: url, message: 'skipped (already completed after race)' });
                  return 0;
                }
                if (raced.status === 'processing') {
                  this.emit('progress', { jobId: meta.jobId, fileUrl: url, message: 'skipped (processing by another worker after race)' });
                  return 0;
                }
                // try to claim again
                const claimed2 = await FileRecord.findOneAndUpdate(
                  { _id: raced._id, status: { $nin: ['processing', 'completed'] } },
                  { $set: { status: 'processing', fetchedAt: new Date() } },
                  { returnDocument: 'after' }
                );
                if (!claimed2) {
                  this.emit('progress', { jobId: meta.jobId, fileUrl: url, message: 'skipped (unable to claim after race)' });
                  return 0;
                }
                // already raced and claimed; proceed
              }
            }
          }
        } catch (e) {
          // ignore claim errors and proceed
        }

        const response = await axios.get(url, { responseType: 'stream', timeout: 60000 });
        const source = response.data;

        let fileWritePromise = null;
        let filePath = null;
        let checksum = null;
        let totalBytes = 0;
        if (writeLatest) {
          const branchSafe = meta.branch ? String(meta.branch).replace(/[<>:"/\\|?*]/g, '_') : 'unknown';
          const dateSafe = meta.workDate ? new Date(meta.workDate).toISOString().slice(0, 10) : 'unknown';
          const baseDir = path.join(downloadDir, branchSafe, dateSafe);
          fs.mkdirSync(baseDir, { recursive: true });
          const origFilename = path.basename(String(meta.sourceFile || url));
          const filename = `${meta.pos != null ? ('pos' + meta.pos + '_') : ''}${origFilename}`;
          filePath = path.join(baseDir, filename);
          const fileStream = fs.createWriteStream(filePath);
          fileWritePromise = new Promise((resolve, reject) => {
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
          });

          // compute checksum and size while streaming
          let hash = crypto.createHash('sha256');
          source.on('data', (chunk) => {
            try {
              hash.update(chunk);
              totalBytes += chunk.length;
            } catch (e) {}
          });

          source.pipe(fileStream);
        }

        const tee = new PassThrough();
        source.pipe(tee);

        // If replacing, backup previous Report rows for this sourceFile then remove them
        try {
          if (strategy === 'replace') {
            const q = { branch: meta.branch, pos: meta.pos, workDate: meta.workDate, sourceFile: sourceFileNormalized };
            const existingDocs = await Report.find(q).lean();
            if (existingDocs && existingDocs.length) {
              const toBackup = existingDocs.map((d) => {
                const copy = { ...d };
                const originalId = copy._id;
                delete copy._id;
                return Object.assign({}, copy, { originalId, replacedAt: new Date(), replacedByJob: meta.jobId });
              });
              try {
                await ReportBackup.insertMany(toBackup, { ordered: false });
              } catch (e) {
                // ignore partial failure; still attempt to remove originals
                console.warn('Partial failure inserting into ReportBackup:', e && e.message ? e.message : e);
              }
              await Report.deleteMany(q);
              this.emit('progress', { jobId: meta.jobId, fileUrl: url, message: `backed up ${toBackup.length} rows and removed previous rows for replace` });
            } else {
              this.emit('progress', { jobId: meta.jobId, fileUrl: url, message: 'no previous rows to backup for replace' });
            }
          }
        } catch (e) {
          console.warn('Failed to backup/delete existing reports for replace:', e && e.message ? e.message : e);
        }

        const parser = tee.pipe(
          parse({
            columns: true,
            relax_quotes: true,
            relax_column_count: true,
            skip_empty_lines: true,
            trim: true,
          })
        );

        let batch = [];
        let totalRows = 0;

        for await (const row of parser) {
          const normalized = normalizeRow(row);
          const uniqueKey = buildUniqueKey(normalized, meta);
          const record = {
            jobId: meta.jobId,
            branch: meta.branch,
            pos: meta.pos,
            workDate: meta.workDate,
            sourceFile: meta.sourceFile || url,
            ingestedAt: new Date(),
            data: normalized,
          };
          if (uniqueKey) record.uniqueKey = uniqueKey;
          batch.push({
            ...record,
          });

          if (batch.length >= meta.batchSize) {
            const insertedCount = await safeInsertMany(batch);
            totalRows += insertedCount;
            this.emit('progress', {
              jobId: meta.jobId,
              fileUrl: url,
              batchRows: insertedCount,
              totalRows,
            });
            batch = [];
          }
        }

        if (batch.length) {
          const insertedCount = await safeInsertMany(batch);
          totalRows += insertedCount;
          this.emit('progress', {
            jobId: meta.jobId,
            fileUrl: url,
            batchRows: insertedCount,
            totalRows,
          });
        }

        if (fileWritePromise) await fileWritePromise;

        if (writeLatest) {
          try {
            // finalize checksum from stream
            if (typeof hash !== 'undefined' && hash) checksum = hash.digest('hex');
            else if (fs.existsSync(filePath)) {
              const data = fs.readFileSync(filePath);
              checksum = crypto.createHash('sha256').update(data).digest('hex');
            }
          } catch (e) {
            // ignore
          }
        }

        // Persist a FileRecord document for the downloaded file (if written locally)
        try {
          if (filePath) {
            const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
            // update or create FileRecord with final metadata (raw storage)
            try {
              await FileRecord.findOneAndUpdate(
                { branch: meta.branch, pos: meta.pos, workDate: meta.workDate, sourceFile: sourceFileNormalized },
                {
                  $set: {
                    filename: path.basename(filePath),
                    branch: meta.branch,
                    pos: meta.pos,
                    workDate: meta.workDate,
                    sourceFile: sourceFileNormalized,
                    storage: { type: 'local', path: filePath },
                    size: stats ? stats.size : totalBytes || undefined,
                    checksum: checksum || undefined,
                    status: 'raw',
                  },
                },
                { upsert: true, returnDocument: 'after' }
              );
            } catch (e) {
              // E11000 duplicate key race may happen; ignore non-fatal
              if (e && e.code === 11000) {
                // ignore duplicate index race
              } else {
                console.warn('Failed to create/update FileRecord (raw):', e && e.message ? e.message : e);
              }
            }
          }
        } catch (e) {
          // Non-fatal: log and continue
          console.warn('Failed to create/update FileRecord:', e && e.message ? e.message : e);
        }

        // At this point, parsing/insert completed successfully. Mark FileRecord as completed.
        try {
          await FileRecord.findOneAndUpdate(
            { branch: meta.branch, pos: meta.pos, workDate: meta.workDate, sourceFile: sourceFileNormalized },
            { $set: { status: 'completed', checksum: checksum || undefined, size: totalBytes || undefined, completedAt: new Date() } },
            { returnDocument: 'after' }
          );
        
        } catch (e) {
          if (e && e.code === 11000) {
            // duplicate key race — harmless for completion marker
          } else {
            console.warn('Failed to mark FileRecord completed:', e && e.message ? e.message : e);
          }
        }

        return totalRows;
      } catch (error) {
        if (attempt >= maxRetries) throw error;
        const delayMs = 500 * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return 0;
  }

  async runJob(job) {
    const { jobId, files, batchSize } = job;
    const startTime = new Date();

    await FetchLog.findOneAndUpdate(
      { jobId },
      {
        status: 'running',
        startedAt: startTime,
        filesTotal: files.length,
      },
      { upsert: true, returnDocument: 'after' }
    );
    // Postgres authoritative: no Mongo mirror

    let totalRows = 0;
    let filesCompleted = 0;

    for (const file of files) {
      try {
        const rows = await this.ingestFile(file.url, {
          jobId,
          branch: file.branch,
          pos: file.pos,
          workDate: file.workDate,
          sourceFile: file.sourceFile,
          batchSize,
        });

        totalRows += rows;
        filesCompleted += 1;

        await FetchLog.findOneAndUpdate(
          { jobId },
          { rowsInserted: totalRows, filesCompleted },
          { returnDocument: 'after' }
        );
        // Postgres authoritative: no Mongo mirror

        this.emit('file-complete', {
          jobId,
          fileUrl: file.url,
          rows,
          filesCompleted,
          filesTotal: files.length,
        });
      } catch (error) {
        const message = error && error.message ? error.message : 'Unknown error';
        await FetchLog.findOneAndUpdate(
          { jobId },
          { $push: { errors: message } },
          { returnDocument: 'after' }
        );
        // Postgres authoritative: no Mongo mirror
        this.emit('error', {
          jobId,
          fileUrl: file.url,
          message,
        });
      }
    }

    const endTime = new Date();
    await FetchLog.findOneAndUpdate(
      { jobId },
      { status: 'completed', finishedAt: endTime, rowsInserted: totalRows, filesCompleted },
      { returnDocument: 'after' }
    );
    // Postgres authoritative: no Mongo mirror

    this.emit('complete', {
      jobId,
      rowsInserted: totalRows,
      filesCompleted,
      filesTotal: files.length,
    });
  }
}

module.exports = StreamWorker;
