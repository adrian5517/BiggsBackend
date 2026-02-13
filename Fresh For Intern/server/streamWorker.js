const axios = require('axios');
const { parse } = require('csv-parse');
const EventEmitter = require('events');
const fs = require('fs');
const { PassThrough } = require('stream');
const path = require('path');

class Fetcher extends EventEmitter {
  constructor(db, options = {}) {
    super();
    this.db = db;
    this.parentDir = options.parentDir || process.cwd();
    this.baseUrl = options.baseUrl || 'https://biggsph.com/biggsinc_loyalty/controller/';
    this.headers = options.headers || {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': 'https://biggsph.com/',
      'Origin': 'https://biggsph.com'
    };
  }

  async fetchFileList(branch, pos, date) {
    const url = this.baseUrl + 'fetch_list2.php';
    const form = new URLSearchParams({ branch, pos, date }).toString();
    const res = await axios.post(url, form, { headers: { ...this.headers, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 });
    if (!res.data || (typeof res.data === 'string' && res.data.includes('<!doctype html>'))) return [''];
    return String(res.data).split(',');
  }

  transform(row, meta) {
    return {
      ...row,
      QUANTITY: row.QUANTITY ? Number(row.QUANTITY) : 0,
      AMOUNT: row.AMOUNT ? Number(row.AMOUNT) : 0,
      DATE: row.DATE ? new Date(row.DATE) : null,
      sourceFile: meta.sourceFile || null,
      fetchJobId: meta.jobId || null,
      ingestedAt: new Date()
    };
  }

  async streamAndIngest(filePath, meta = {}, batchSize = 1000, writeToDisk = true) {
    if (!filePath) return 0;
    const url = this.baseUrl + filePath;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await axios.get(url, { responseType: 'stream', headers: this.headers, timeout: 60000 });

        // Prepare tee streams
        const tee = new PassThrough();
        res.data.pipe(tee);

        // Write raw bytes to latest/filename so Combiner can read the same file
        if (writeToDisk) {
          try {
            const filename = path.basename(filePath);
            const outDir = path.join(this.parentDir, 'latest');
            if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
            const outPath = path.join(outDir, filename);
            const writeStream = fs.createWriteStream(outPath);
            // Pipe a separate copy of the response for file write
            const fileTee = new PassThrough();
            res.data.pipe(fileTee);
            fileTee.pipe(writeStream);
          } catch (fsErr) {
            this.emit('error', { file: filePath, attempt, message: `disk-write-failed: ${fsErr.message}`, jobId: meta.jobId });
          }
        }

        const parser = tee.pipe(parse({ columns: true, relax_quotes: true, trim: true }));

        let batch = [];
        let inserted = 0;
        for await (const row of parser) {
          batch.push(this.transform(row, { ...meta, sourceFile: filePath }));
          if (batch.length >= batchSize) {
            await this.db.collection('reports').insertMany(batch, { ordered: false }).catch(e => {});
            inserted += batch.length;
            this.emit('progress', { file: filePath, rows: inserted, jobId: meta.jobId });
            batch = [];
          }
        }
        if (batch.length) {
          await this.db.collection('reports').insertMany(batch, { ordered: false }).catch(e => {});
          inserted += batch.length;
          this.emit('progress', { file: filePath, rows: inserted, jobId: meta.jobId });
        }
        return inserted;
      } catch (err) {
        this.emit('error', { file: filePath, attempt, message: err.message, jobId: meta.jobId });
        await new Promise(r => setTimeout(r, 1000 * attempt));
        if (attempt === 3) throw err;
      }
    }
  }

  async runFor(branch, pos, date, jobMeta = {}) {
    const files = await this.fetchFileList(branch, pos, date);
    let totalRows = 0;
    for (const f of files) {
      if (!f) continue;
      const inserted = await this.streamAndIngest(f, { ...jobMeta, sourceFile: f }, 1000, true);
      totalRows += inserted;
    }
    return totalRows;
  }
}

module.exports = Fetcher;
