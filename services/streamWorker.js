const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
const axios = require('axios');
const { parse } = require('csv-parse');

const Report = require('../models/reportModel');
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
    const latestDir = process.env.POS_LATEST_DIR || 'latest';

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await axios.get(url, { responseType: 'stream', timeout: 60000 });
        const source = response.data;

        let fileWritePromise = null;
        if (writeLatest) {
          fs.mkdirSync(latestDir, { recursive: true });
          const filename = path.basename(String(meta.sourceFile || url));
          const filePath = path.join(latestDir, filename);
          const fileStream = fs.createWriteStream(filePath);
          fileWritePromise = new Promise((resolve, reject) => {
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
          });
          source.pipe(fileStream);
        }

        const tee = new PassThrough();
        source.pipe(tee);

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
          batch.push({
            jobId: meta.jobId,
            branch: meta.branch,
            pos: meta.pos,
            workDate: meta.workDate,
            uniqueKey: buildUniqueKey(normalized, meta),
            sourceFile: meta.sourceFile || url,
            ingestedAt: new Date(),
            data: normalized,
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

    this.emit('complete', {
      jobId,
      rowsInserted: totalRows,
      filesCompleted,
      filesTotal: files.length,
    });
  }
}

module.exports = StreamWorker;
