const fs = require('fs');
const path = require('path');

const StreamWorker = require('../services/streamWorker');
const FetchLog = require('../models/fetchLogModel');
const Report = require('../models/reportModel');

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
  const method = (process.env.POS_LIST_METHOD || 'POST').toUpperCase();

  const maxRetries = Number(process.env.POS_LIST_RETRIES) || 3;
  const timeoutMs = Number(process.env.POS_LIST_TIMEOUT_MS) || 20000;
  let response;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      if (method === 'GET') {
        response = await require('axios')({
          url: listUrl,
          method,
          headers,
          params: payload,
          timeout: timeoutMs,
        });
      } else {
        const formBody = new URLSearchParams(payload).toString();
        const mergedHeaders = { 'Content-Type': 'application/x-www-form-urlencoded', ...headers };
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
  if (typeof rawData === 'string') {
    return rawData
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const path = process.env.POS_LIST_RESPONSE_PATH || 'files';
  const files = getPathValue(rawData, path) || [];
  return Array.isArray(files) ? files : [];
}

function resolveFileUrl(item) {
  if (!item) return null;
  const template = process.env.POS_FILE_URL_TEMPLATE;
  const explicitField = process.env.POS_FILE_URL_FIELD;
  const baseUrl = process.env.POS_FILE_BASE_URL || 'https://biggsph.com/biggsinc_loyalty/controller/';

  if (typeof item === 'string') {
    const value = item;
    if (template) return template.replace(/\{\{\s*file\s*\}\}/g, value);
    if (/^https?:\/\//i.test(value)) return value;
    return `${baseUrl}${value}`;
  }

  if (explicitField && item[explicitField]) {
    const value = item[explicitField];
    if (template) return template.replace(/\{\{\s*file\s*\}\}/g, value);
    if (/^https?:\/\//i.test(value)) return value;
    return `${baseUrl}${value}`;
  }

  const fallback = item.url || item.fileUrl || item.path || item.filename || item.file || item.name;
  if (!fallback) return null;
  if (template) return template.replace(/\{\{\s*file\s*\}\}/g, fallback);
  if (/^https?:\/\//i.test(fallback)) return fallback;
  return `${baseUrl}${fallback}`;
}

exports.streamStatus = (req, res) => {
  const jobId = req.query.jobId || 'global';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  if (!clients.has(jobId)) clients.set(jobId, new Set());
  clients.get(jobId).add(res);

  req.on('close', () => {
    const set = clients.get(jobId);
    if (set) set.delete(res);
  });
};

exports.startFetch = async (req, res) => {
  const { start, end, files, branches, positions, mode } = req.body || {};
  const jobId = `${Date.now()}`;

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
    const branchList = resolveBranchList(branches);
    const posList = normalizePositions(positions || process.env.POS_POSITIONS || '1,2');
    const dates = buildDateRange(start, end);

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
  }

  if (!fileList.length) {
    return res.status(400).json({
      message: 'No files to fetch. Provide files[] or configure POS_LIST_URL and POS_FILE_URL_TEMPLATE.',
    });
  }

  await FetchLog.create({
    jobId,
    status: 'queued',
    mode: mode || 'range',
    startDate: start,
    endDate: end,
    branches: normalizeList(branches),
    positions: normalizePositions(positions),
    filesTotal: fileList.length,
  });

  res.status(202).json({ jobId, filesQueued: fileList.length });

  const batchSize = Number(process.env.POS_BATCH_SIZE) || 1000;
  streamWorker.runJob({ jobId, files: fileList, batchSize });
};

exports.startMissingFetch = async (req, res) => {
  const { branches_missing: branchesMissing, files } = req.body || {};
  const jobId = `${Date.now()}`;

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
  }

  if (!fileList.length) {
    return res.status(400).json({
      message: 'No files to fetch. Provide files[] or configure POS_LIST_URL and POS_FILE_URL_TEMPLATE.',
    });
  }

  await FetchLog.create({
    jobId,
    status: 'queued',
    mode: 'missing',
    filesTotal: fileList.length,
  });

  res.status(202).json({ jobId, filesQueued: fileList.length });

  const batchSize = Number(process.env.POS_BATCH_SIZE) || 1000;
  streamWorker.runJob({ jobId, files: fileList, batchSize });
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
    const branchList = resolveBranchList(branches);
    const posList = normalizePositions(positions || process.env.POS_POSITIONS || '1,2');
    const dates = buildDateRange(startDate, endDate);

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
  }

  if (!fileList.length) {
    jobLogUpdates.delete(jobId);
    return res.status(400).json({
      message: 'No files to fetch. Provide files[] or configure POS_LIST_URL and POS_FILE_URL_TEMPLATE.',
    });
  }

  await FetchLog.create({
    jobId,
    status: 'queued',
    mode: mode || 'range',
    startDate,
    endDate,
    branches: normalizeList(branches),
    positions: normalizePositions(positions),
    filesTotal: fileList.length,
  });

  res.status(202).json({ jobId, start: startDate, end: endDate, filesQueued: fileList.length });

  const batchSize = Number(process.env.POS_BATCH_SIZE) || 1000;
  streamWorker.runJob({ jobId, files: fileList, batchSize });
};

exports.getReports = async (req, res) => {
  const { branch, pos, date, page = 1, limit = 50 } = req.query || {};
  const query = {};

  if (branch) query.branch = branch;
  if (pos) query.pos = Number(pos);
  if (date) {
    const workDate = new Date(String(date));
    if (!Number.isNaN(workDate.getTime())) query.workDate = workDate;
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
