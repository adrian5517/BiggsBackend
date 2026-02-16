const fs = require('fs');
const path = require('path');

const StreamWorker = require('../services/streamWorker');
const FetchLog = require('../models/fetchLogModel');
const Report = require('../models/reportModel');
const jobBus = require('../services/jobBus');
const combinerWorker = require('../services/combinerWorker');

const streamWorker = new StreamWorker();
const clients = new Map();
const jobLogUpdates = new Map();

function broadcast(jobId, payload) {
  const targets = new Set();
  if (clients.has(jobId)) {
    for (const res of clients.get(jobId)) targets.add(res);
  }
  if (clients.has('global')) {
    for (const res of clients.get('global')) targets.add(res);
  }
  if (!targets.size) return;

  const message = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of targets) {
    res.write(message);
  }
}

streamWorker.on('progress', (data) => {
  broadcast(data.jobId, { type: 'progress', ...data });
});

streamWorker.on('file-complete', (data) => {
  broadcast(data.jobId, { type: 'file-complete', ...data });
});

streamWorker.on('error', (data) => {
  broadcast(data.jobId, { type: 'error', ...data });
});

streamWorker.on('complete', (data) => {
  broadcast(data.jobId, { type: 'complete', ...data });
  if (jobLogUpdates.has(data.jobId)) {
    const logPath = jobLogUpdates.get(data.jobId);
    jobLogUpdates.delete(data.jobId);
    try {
      const today = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(logPath, today, 'utf8');
    } catch (error) {
      console.warn('Failed to update last_record.log:', error && error.message ? error.message : error);
    }
  }
});

// forward combiner jobBus events to SSE clients
jobBus.on('progress', (data) => {
  broadcast(data.jobId || 'global', { type: 'progress', ...data });
});
jobBus.on('file-start', (data) => {
  broadcast(data.jobId || 'global', { type: 'file-start', ...data });
});
jobBus.on('file-complete', (data) => {
  broadcast(data.jobId || 'global', { type: 'file-complete', ...data });
});
jobBus.on('error', (data) => {
  broadcast(data.jobId || 'global', { type: 'error', ...data });
});
jobBus.on('complete', (data) => {
  broadcast(data.jobId || 'global', { type: 'complete', ...data });
});

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function loadBranchesFromFiles() {
  const roots = [process.cwd(), path.resolve(process.cwd(), '..')];
  const files = ['settings/branches.txt', 'settings/newBranches.txt'];
  const branches = new Set();

  for (const root of roots) {
    for (const file of files) {
      const filePath = path.join(root, file);
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .forEach((line) => branches.add(line));
    }
  }

  return Array.from(branches);
}

function resolveBranchList(branches) {
  const envBranches = normalizeList(process.env.POS_BRANCHES);
  if (branches) return normalizeList(branches);
  if (envBranches.length) return envBranches;
  return loadBranchesFromFiles();
}

function readLastRecordDate(logPath) {
  if (!fs.existsSync(logPath)) return null;
  const content = fs.readFileSync(logPath, 'utf8').trim();
  if (!content) return null;
  const parsed = new Date(content);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function getYesterday() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function normalizePositions(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  return String(value)
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v));
}

function buildDateRange(start, end) {
  if (!start || !end) return [];
  const dates = [];
  const current = new Date(start);
  const last = new Date(end);
  if (Number.isNaN(current.getTime()) || Number.isNaN(last.getTime())) return [];
  current.setHours(0, 0, 0, 0);
  last.setHours(0, 0, 0, 0);
  while (current <= last) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function replaceTemplate(value, context) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\{\{\s*branch\s*\}\}/g, context.branch)
    .replace(/\{\{\s*pos\s*\}\}/g, String(context.pos))
    .replace(/\{\{\s*date\s*\}\}/g, context.date);
}

function getPathValue(obj, path) {
  if (!path) return obj;
  return path.split('.').reduce((acc, key) => (acc && acc[key] != null ? acc[key] : undefined), obj);
}

async function listRemoteFiles({ branch, pos, date }) {
  const listUrl = process.env.POS_LIST_URL || 'https://biggsph.com/biggsinc_loyalty/controller/fetch_list2.php';

  const payloadTemplate = process.env.POS_LIST_PAYLOAD_TEMPLATE;
  let payload = { branch, pos, date };

  if (payloadTemplate) {
    try {
      const parsed = JSON.parse(payloadTemplate);
      payload = Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, replaceTemplate(value, { branch, pos, date })])
      );
    } catch (e) {
      payload = { branch, pos, date };
    }
  }

  let headers;
  if (process.env.POS_LIST_HEADERS) {
    try {
      headers = JSON.parse(process.env.POS_LIST_HEADERS);
    } catch (e) {
      headers = undefined;
    }
  }
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.12; rv:55.0) Gecko/20100101 Firefox/55.0',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    Referer: 'https://biggsph.com/',
    Origin: 'https://biggsph.com',
  };
  const method = (process.env.POS_LIST_METHOD || 'POST').toUpperCase();

  const maxRetries = Number(process.env.POS_LIST_RETRIES) || 3;
  const timeoutMs = Number(process.env.POS_LIST_TIMEOUT_MS) || 20000;
  let response;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      if (method === 'GET') {
        const mergedHeaders = { ...defaultHeaders, ...(headers || {}) };
        response = await require('axios')({
          url: listUrl,
          method,
          headers: mergedHeaders,
          params: payload,
          timeout: timeoutMs,
        });
      } else {
        const formBody = new URLSearchParams(payload).toString();
        const mergedHeaders = { 'Content-Type': 'application/x-www-form-urlencoded', ...defaultHeaders, ...(headers || {}) };
        response = await require('axios')({
          url: listUrl,
          method,
          headers: mergedHeaders,
          data: formBody,
          timeout: timeoutMs,
        });
      }
      break;
    } catch (error) {
      if (attempt >= maxRetries) throw error;
      const delayMs = 500 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const rawData = response.data;
  if (process.env.POS_DEBUG === 'true') {
    try {
      console.log('[POS DEBUG] listRemoteFiles response', { listUrl, payload, rawData });
    } catch (e) {
      // ignore logging errors
    }
  }
  if (typeof rawData === 'string') {
    const lowered = rawData.toLowerCase();
    const isNoList = lowered.includes('no list') || lowered.includes('no files') || lowered.includes('error') || lowered.includes('<!doctype html>');
    if (isNoList) {
      // If caller configured fallback files via env, use them (JSON array string)
      if (process.env.POS_LIST_FALLBACK_FILES) {
        try {
          const parsed = JSON.parse(process.env.POS_LIST_FALLBACK_FILES);
          if (Array.isArray(parsed) && parsed.length) {
            if (process.env.POS_DEBUG === 'true') console.log('[POS DEBUG] using POS_LIST_FALLBACK_FILES', parsed);
            return parsed;
          }
        } catch (e) {
          if (process.env.POS_DEBUG === 'true') console.warn('[POS DEBUG] failed to parse POS_LIST_FALLBACK_FILES', e && e.message ? e.message : e);
        }
      }
      return [];
    }
    return rawData
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const path = process.env.POS_LIST_RESPONSE_PATH || 'files';
  const files = getPathValue(rawData, path) || [];
  if (Array.isArray(files) && files.length) return files;

  // if empty and fallback configured, return fallback
  if ((!files || files.length === 0) && process.env.POS_LIST_FALLBACK_FILES) {
    try {
      const parsed = JSON.parse(process.env.POS_LIST_FALLBACK_FILES);
      if (Array.isArray(parsed) && parsed.length) {
        if (process.env.POS_DEBUG === 'true') console.log('[POS DEBUG] using POS_LIST_FALLBACK_FILES (response path empty)', parsed);
        return parsed;
      }
    } catch (e) {
      if (process.env.POS_DEBUG === 'true') console.warn('[POS DEBUG] failed to parse POS_LIST_FALLBACK_FILES', e && e.message ? e.message : e);
    }
  }

  return Array.isArray(files) ? files : [];
}

const posService = require('../services/pos');

function resolveFileUrl(item) {
  try {
    return posService.buildFileUrl(item);
  } catch (e) {
    if (process.env.POS_DEBUG === 'true') console.warn('[POS DEBUG] resolveFileUrl error', e && e.message ? e.message : e);
    return null;
  }
}

async function collectFilesFromRange({ start, end, branches, positions }) {
  const branchList = resolveBranchList(branches);
  const posList = normalizePositions(positions || process.env.POS_POSITIONS || '1,2');
  const dates = buildDateRange(start, end);
  const fileList = [];

  for (const branch of branchList) {
    for (const pos of posList) {
      for (const workDate of dates) {
        const date = workDate.toISOString().slice(0, 10);
        const items = await listRemoteFiles({ branch, pos, date });
        for (const item of items) {
          const url = resolveFileUrl(item);
          if (!url) continue;
          fileList.push({ url, branch, pos, workDate, sourceFile: url });
        }
      }
    }
  }

  return fileList;
}

async function collectFilesFromMissing(branchesMissing) {
  const fileList = [];
  const branches = Object.keys(branchesMissing || {});

  for (const branch of branches) {
    const posEntries = branchesMissing[branch] || {};
    for (const [posKey, dates] of Object.entries(posEntries)) {
      const pos = Number(posKey);
      for (const date of dates || []) {
        const items = await listRemoteFiles({ branch, pos, date });
        for (const item of items) {
          const url = resolveFileUrl(item);
          if (!url) continue;
          fileList.push({ url, branch, pos, workDate: new Date(date), sourceFile: url });
        }
      }
    }
  }

  return fileList;
}

exports.streamStatus = (req, res) => {
  const jobId = req.query.jobId || 'global';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('\n');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  if (!clients.has(jobId)) clients.set(jobId, new Set());
  clients.get(jobId).add(res);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const set = clients.get(jobId);
    if (set) set.delete(res);
  });
};

exports.startFetch = async (req, res) => {
  const { start, end, files, branches, positions, mode } = req.body || {};
  const jobId = `${Date.now()}`;

  try {
    const pgLog = await FetchLog.create({
      jobId,
      status: 'queued',
      mode: mode || 'range',
      startDate: start,
      endDate: end,
      branches: normalizeList(branches),
      positions: normalizePositions(positions),
      filesTotal: 0,
    });
  } catch (err) {
    console.error('Failed to create FetchLog (startFetch):', err && err.stack ? err.stack : err);
    const isMongoQuota = err && (err.name === 'MongoServerError' || (err.message && String(err.message).toLowerCase().includes('over your space quota')));
    if (isMongoQuota) {
      return res.status(507).json({ message: 'MongoDB storage quota exceeded. Free up space or upgrade your plan.' });
    }
    return res.status(500).json({ message: err && err.message ? err.message : 'Failed to create fetch log' });
  }

  res.status(202).json({ jobId, filesQueued: 0 });

  broadcast(jobId, { type: 'queued', jobId, message: 'Collecting file list...' });

  (async () => {
    let fileList = [];
    if (Array.isArray(files) && files.length) {
      fileList = files
        .map((file) => ({
          url: file.url || file.fileUrl || file,
          branch: file.branch,
          pos: file.pos != null ? Number(file.pos) : undefined,
          workDate: file.workDate ? new Date(file.workDate) : undefined,
          sourceFile: file.sourceFile,
        }))
        .filter((file) => Boolean(file.url));
    }

    if (!fileList.length && start && end) {
      fileList = await collectFilesFromRange({ start, end, branches, positions });
    }

    if (!fileList.length) {
      await FetchLog.findOneAndUpdate(
          { jobId },
          { status: 'failed', errors: ['No files to fetch. Provide files[] or configure POS_LIST_URL and POS_FILE_URL_TEMPLATE.'] }
        );
      broadcast(jobId, {
        type: 'error',
        jobId,
        message: 'No files to fetch. Provide files[] or configure POS_LIST_URL and POS_FILE_URL_TEMPLATE.',
      });
      return;
    }

    await FetchLog.findOneAndUpdate({ jobId }, { filesTotal: fileList.length });
    broadcast(jobId, { type: 'queued', jobId, filesTotal: fileList.length, message: 'Starting ingestion.' });

    const batchSize = Number(process.env.POS_BATCH_SIZE) || 1000;
    streamWorker.runJob({ jobId, files: fileList, batchSize });
  })().catch(async (error) => {
    const message = error && error.message ? error.message : 'Failed to prepare fetch job.';
    await FetchLog.findOneAndUpdate({ jobId }, { status: 'failed', errors: [message] });
    broadcast(jobId, { type: 'error', jobId, message });
  });
};

// Manual fetch helper: accepts { date, branches, positions, files }
// Sets start and end to the provided date and delegates to startFetch
exports.manualFetch = async (req, res) => {
  try {
    // Accept date from body or query string for convenience
    const date = (req.body && req.body.date) ? String(req.body.date) : (req.query && req.query.date ? String(req.query.date) : null);
    if (!date) return res.status(400).json({ message: 'Missing required field: date' });

    // Accept optional branches/positions from query as fallback
    const queryBranches = req.query && (req.query.branches || req.query.branch) ? (req.query.branches || req.query.branch) : undefined;
    const queryPositions = req.query && (req.query.positions || req.query.pos) ? (req.query.positions || req.query.pos) : undefined;

    // copy existing body and set start/end to the provided date; merge query fallbacks
    req.body = {
      ...(req.body || {}),
      start: date,
      end: date,
      branches: (req.body && req.body.branches) ? req.body.branches : queryBranches,
      positions: (req.body && req.body.positions) ? req.body.positions : queryPositions,
    };

    // Delegate to startFetch and ensure any unexpected errors are returned as JSON
    await exports.startFetch(req, res);
  } catch (error) {
    console.error('manualFetch error:', error && error.stack ? error.stack : error);
    if (!res.headersSent) {
      return res.status(500).json({ message: error && error.message ? error.message : 'Server error' });
    }
    return;
  }
};

exports.startMissingFetch = async (req, res) => {
  const { branches_missing: branchesMissing, files } = req.body || {};
  const jobId = `${Date.now()}`;

  try {
    const pgLog = await FetchLog.create({
      jobId,
      status: 'queued',
      mode: 'missing',
      filesTotal: 0,
    });
  } catch (err) {
      console.error('Failed to create FetchLog (startMissingFetch):', err && err.stack ? err.stack : err);
      const isMongoQuota = err && (err.name === 'MongoServerError' || (err.message && String(err.message).toLowerCase().includes('over your space quota')));
      if (isMongoQuota) {
        return res.status(507).json({ message: 'MongoDB storage quota exceeded. Free up space or upgrade your plan.' });
      }
      return res.status(500).json({ message: err && err.message ? err.message : 'Failed to create fetch log' });
  }

  res.status(202).json({ jobId, filesQueued: 0 });

  broadcast(jobId, { type: 'queued', jobId, message: 'Collecting missing file list...' });

  (async () => {
    let fileList = [];
    if (Array.isArray(files) && files.length) {
      fileList = files
        .map((file) => ({
          url: file.url || file.fileUrl || file,
          branch: file.branch,
          pos: file.pos != null ? Number(file.pos) : undefined,
          workDate: file.workDate ? new Date(file.workDate) : undefined,
          sourceFile: file.sourceFile,
        }))
        .filter((file) => Boolean(file.url));
    }

    if (!fileList.length && branchesMissing) {
      fileList = await collectFilesFromMissing(branchesMissing);
    }

    if (!fileList.length) {
      await FetchLog.findOneAndUpdate(
        { jobId },
        { status: 'failed', errors: ['No files to fetch. Provide files[] or configure POS_LIST_URL and POS_FILE_URL_TEMPLATE.'] }
      );
      broadcast(jobId, {
        type: 'error',
        jobId,
        message: 'No files to fetch. Provide files[] or configure POS_LIST_URL and POS_FILE_URL_TEMPLATE.',
      });
      return;
    }

    await FetchLog.findOneAndUpdate({ jobId }, { filesTotal: fileList.length });
    broadcast(jobId, { type: 'queued', jobId, filesTotal: fileList.length, message: 'Starting ingestion.' });

    const batchSize = Number(process.env.POS_BATCH_SIZE) || 1000;
    streamWorker.runJob({ jobId, files: fileList, batchSize });
  })().catch(async (error) => {
    const message = error && error.message ? error.message : 'Failed to prepare missing fetch job.';
    await FetchLog.findOneAndUpdate({ jobId }, { status: 'failed', errors: [message] });
    broadcast(jobId, { type: 'error', jobId, message });
  });
};

exports.startFromLog = async (req, res) => {
  const logPath = req.body && req.body.logPath
    ? String(req.body.logPath)
    : process.env.LAST_RECORD_LOG || path.join(process.cwd(), 'last_record.log');

  const startDate = readLastRecordDate(logPath);
  if (!startDate) {
    return res.status(400).json({ message: 'last_record.log is missing or invalid.' });
  }

  const endDate = (req.body && req.body.end) ? String(req.body.end) : getYesterday();

  req.body = {
    ...(req.body || {}),
    start: startDate,
    end: endDate,
  };

  const jobId = `${Date.now()}`;
  jobLogUpdates.set(jobId, logPath);

  const { files, branches, positions, mode } = req.body || {};

  try {
    const pgLog = await FetchLog.create({
      jobId,
      status: 'queued',
      mode: mode || 'range',
      startDate,
      endDate,
      branches: normalizeList(branches),
      positions: normalizePositions(positions),
      filesTotal: 0,
    });
      
  } catch (err) {
    console.error('Failed to create FetchLog (startFromLog):', err && err.stack ? err.stack : err);
    const isMongoQuota = err && (err.name === 'MongoServerError' || (err.message && String(err.message).toLowerCase().includes('over your space quota')));
    if (isMongoQuota) {
      return res.status(507).json({ message: 'MongoDB storage quota exceeded. Free up space or upgrade your plan.' });
    }
    return res.status(500).json({ message: err && err.message ? err.message : 'Failed to create fetch log' });
  }

  res.status(202).json({ jobId, start: startDate, end: endDate, filesQueued: 0 });

  broadcast(jobId, { type: 'queued', jobId, message: 'Collecting file list...' });

  (async () => {
    let fileList = [];

    if (Array.isArray(files) && files.length) {
      fileList = files
        .map((file) => ({
          url: file.url || file.fileUrl || file,
          branch: file.branch,
          pos: file.pos != null ? Number(file.pos) : undefined,
          workDate: file.workDate ? new Date(file.workDate) : undefined,
          sourceFile: file.sourceFile,
        }))
        .filter((file) => Boolean(file.url));
    }

    if (!fileList.length) {
      fileList = await collectFilesFromRange({ start: startDate, end: endDate, branches, positions });
    }

    if (!fileList.length) {
      jobLogUpdates.delete(jobId);
      await FetchLog.findOneAndUpdate(
        { jobId },
        { status: 'failed', errors: ['No files to fetch. Provide files[] or configure POS_LIST_URL and POS_FILE_URL_TEMPLATE.'] }
      );
      broadcast(jobId, {
        type: 'error',
        jobId,
        message: 'No files to fetch. Provide files[] or configure POS_LIST_URL and POS_FILE_URL_TEMPLATE.',
      });
      return;
    }

    await FetchLog.findOneAndUpdate({ jobId }, { filesTotal: fileList.length });
    broadcast(jobId, { type: 'queued', jobId, filesTotal: fileList.length, message: 'Starting ingestion.' });

    const batchSize = Number(process.env.POS_BATCH_SIZE) || 1000;
    streamWorker.runJob({ jobId, files: fileList, batchSize });
  })().catch(async (error) => {
    jobLogUpdates.delete(jobId);
    const message = error && error.message ? error.message : 'Failed to prepare log-based fetch job.';
    await FetchLog.findOneAndUpdate({ jobId }, { status: 'failed', errors: [message] });
    broadcast(jobId, { type: 'error', jobId, message });
  });
};

// Start a combiner job which scans a workdir and produces combined/master output
exports.startCombine = async (req, res) => {
  const { workdir = process.env.COMBINER_WORKDIR || 'latest', outFile } = req.body || {};
  const jobId = `${Date.now()}`;

  try {
    const pgLog = await FetchLog.create({ jobId, status: 'queued', mode: 'combine', filesTotal: 0 });
  } catch (err) {
    console.error('Failed to create FetchLog (startCombine):', err && err.stack ? err.stack : err);
    const isMongoQuota = err && (err.name === 'MongoServerError' || (err.message && String(err.message).toLowerCase().includes('over your space quota')));
    if (isMongoQuota) {
      return res.status(507).json({ message: 'MongoDB storage quota exceeded. Free up space or upgrade your plan.' });
    }
    return res.status(500).json({ message: err && err.message ? err.message : 'Failed to create fetch log' });
  }

  res.status(202).json({ jobId, workdir });

  broadcast(jobId, { type: 'queued', jobId, message: `Starting combiner for workdir=${workdir}` });

  (async () => {
    try {
      await combinerWorker.runJob({ jobId, workdir, outFile });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      await FetchLog.findOneAndUpdate({ jobId }, { status: 'failed', errors: [message] });
      broadcast(jobId, { type: 'error', jobId, message });
    }
  })();
};

// Scan missing branch/pos/date combinations; if `autoQueue` true, queue a missing-fetch job
exports.scanMissing = async (req, res) => {
  try {
    const missingScanner = require('../services/missingScanner');
    const { workdir, start, end, branches, positions, sampleFile, autoQueue } = req.body || {};
    const parsedBranches = Array.isArray(branches) ? branches : branches ? String(branches).split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    const parsedPositions = Array.isArray(positions) ? positions.map(String) : positions ? String(positions).split(',').map((s) => s.trim()).filter(Boolean) : undefined;

    const result = await missingScanner.scan({ workdir, start, end, branches: parsedBranches, positions: parsedPositions, sampleFile });

    // If not auto-queueing, return scan results immediately
    if (!autoQueue) return res.json(result);

    // Build branches_missing shape expected by startMissingFetch / collectFilesFromMissing
    const branches_missing = {};
    for (const r of result.results || []) {
      if (r.missingDates && r.missingDates.length) {
        branches_missing[r.branch] = branches_missing[r.branch] || {};
        branches_missing[r.branch][String(r.pos)] = r.missingDates;
      }
    }

    if (!Object.keys(branches_missing).length) {
      return res.status(200).json({ ...result, queued: false, message: 'No missing combinations found to queue.' });
    }

    const jobId = `${Date.now()}`;
      try {
      const pgLog = await FetchLog.create({ jobId, status: 'queued', mode: 'missing-scan-queue', filesTotal: 0 });
    } catch (err) {
      console.error('Failed to create FetchLog (scanMissing autoQueue):', err && err.stack ? err.stack : err);
      return res.status(500).json({ message: err && err.message ? err.message : 'Failed to create fetch log' });
    }

    res.status(202).json({ ...result, queued: true, jobId });

    broadcast(jobId, { type: 'queued', jobId, message: `Queued missing-fetch job for ${Object.keys(branches_missing).length} branches` });

    // Start async job similar to startMissingFetch
    (async () => {
      try {
        let fileList = [];
        fileList = await collectFilesFromMissing(branches_missing);

        if (!fileList.length) {
          await FetchLog.findOneAndUpdate({ jobId }, { status: 'failed', errors: ['No files to fetch for missing combinations.'] });
          broadcast(jobId, { type: 'error', jobId, message: 'No files to fetch for missing combinations.' });
          return;
        }
        await FetchLog.findOneAndUpdate({ jobId }, { filesTotal: fileList.length });
        broadcast(jobId, { type: 'queued', jobId, filesTotal: fileList.length, message: 'Starting ingestion for missing combinations.' });

        const batchSize = Number(process.env.POS_BATCH_SIZE) || 1000;
        streamWorker.runJob({ jobId, files: fileList, batchSize });
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        await FetchLog.findOneAndUpdate({ jobId }, { status: 'failed', errors: [message] });
        broadcast(jobId, { type: 'error', jobId, message });
      }
    })();

    return;
  } catch (error) {
    return res.status(500).json({ message: error && error.message ? error.message : String(error) });
  }
};

exports.getReports = async (req, res) => {
  const { branch, pos, date, page = 1, limit = 50 } = req.query || {};
  const query = {};

  if (branch) query.branch = branch;
  if (pos) query.pos = Number(pos);
  if (date) {
    const workDate = new Date(String(date));
    if (!Number.isNaN(workDate.getTime())) {
      const nextDay = new Date(workDate);
      nextDay.setDate(nextDay.getDate() + 1);
      query.workDate = { $gte: workDate, $lt: nextDay };
    }
  }

  const pageNumber = Number(page) || 1;
  const pageLimit = Math.min(Number(limit) || 50, 500);

  const [items, total] = await Promise.all([
    Report.find(query)
      .sort({ workDate: -1 })
      .skip((pageNumber - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),
    Report.countDocuments(query),
  ]);

  res.json({ items, total, page: pageNumber, pageSize: pageLimit });
};

// Return distinct branch list from stored FileRecord or Report collections
exports.getBranches = async (req, res) => {
  try {
    const FileRecord = require('../models/fileRecordModel');
    // prefer FileRecord branches; fall back to Report collection if none
    let branches = await FileRecord.distinct('branch');
    branches = (branches || []).filter(Boolean).sort();
    if (!branches.length) {
      const Report = require('../models/reportModel');
      branches = await Report.distinct('branch');
      branches = (branches || []).filter(Boolean).sort();
    }
    res.json({ branches });
  } catch (error) {
    res.status(500).json({ message: error && error.message ? error.message : String(error) });
  }
};

// Temporary debug endpoint to test listRemoteFiles parsing without running a full job
exports.debugList = async (req, res) => {
  const { branch, pos, date } = req.body || {};
  try {
    const files = await listRemoteFiles({ branch, pos, date });
    return res.json({ files });
  } catch (error) {
    return res.status(500).json({ message: error && error.message ? error.message : String(error) });
  }
};

// Stream raw file contents (from local storage path recorded in FileRecord)
exports.streamFileRaw = async (req, res) => {
  try {
    const FileRecord = require('../models/fileRecordModel');
    const { id } = req.params;
    const record = await FileRecord.findById(id);
    if (!record || !record.storage || !record.storage.path) return res.status(404).json({ message: 'File not found' });

    const filePath = record.storage.path;
    if (!require('fs').existsSync(filePath)) return res.status(404).json({ message: 'File not found on disk' });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${record.filename || 'file.csv'}"`);
    const stream = require('fs').createReadStream(filePath);
    stream.on('error', (err) => {
      console.warn('Stream error:', err && err.message ? err.message : err);
      res.end();
    });
    stream.pipe(res);
  } catch (error) {
    console.error('streamFileRaw error:', error);
    res.status(500).json({ message: error && error.message ? error.message : String(error) });
  }
};

// Stream parsed CSV rows as NDJSON for incremental rendering
// If ?limit=N provided, buffer up to N rows and return as JSON array quickly
exports.streamFileRows = async (req, res) => {
  try {
    const FileRecord = require('../models/fileRecordModel');
    const { id } = req.params;
    const limit = req.query && req.query.limit ? Number(req.query.limit) : 0;

    const record = await FileRecord.findById(id);
    if (!record || !record.storage || !record.storage.path) return res.status(404).json({ message: 'File not found' });
    const filePath = record.storage.path;
    if (!require('fs').existsSync(filePath)) return res.status(404).json({ message: 'File not found on disk' });

    const fs = require('fs');
    const { parse } = require('csv-parse');

    // Preview mode: return buffered JSON array
    if (limit && limit > 0) {
      const rows = [];
      const parser = fs.createReadStream(filePath).pipe(parse({ columns: true, relax_quotes: true, relax_column_count: true, skip_empty_lines: true, trim: true }));
      for await (const row of parser) {
        rows.push(row);
        if (rows.length >= limit) break;
      }
      return res.json({ items: rows, preview: true });
    }

    // Full streaming as NDJSON
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');

    const parser = fs.createReadStream(filePath).pipe(parse({ columns: true, relax_quotes: true, relax_column_count: true, skip_empty_lines: true, trim: true }));

    parser.on('error', (err) => {
      console.warn('CSV parse error:', err && err.message ? err.message : err);
      // end the response
      try { res.end(); } catch (e) {}
    });

    for await (const row of parser) {
      // write each row as a JSON line
      const ok = res.write(`${JSON.stringify(row)}\n`);
      if (!ok) {
        // backpressure: wait for drain
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }

    res.end();
  } catch (error) {
    console.error('streamFileRows error:', error);
    res.status(500).json({ message: error && error.message ? error.message : String(error) });
  }
};
