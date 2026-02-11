const Queue = require('bullmq').Queue;
const FileRecord = require('../models/fileRecordModel');
const MonitorEntry = require('../models/monitorEntryModel');

async function status(req, res) {
  try {
    const recentFiles = await FileRecord.find().sort({ createdAt: -1 }).limit(10).lean();
    const recentMonitors = await MonitorEntry.find().sort({ createdAt: -1 }).limit(10).lean();

    const REDIS_URL = process.env.REDIS_URL || process.env.REDIS || null;
    let queueInfo = { enabled: false };
    if (REDIS_URL) {
      try {
        const q = new Queue('importQueue', { connection: { url: REDIS_URL } });
        const counts = await q.getJobCounts();
        queueInfo = { enabled: true, counts };
        await q.close();
      } catch (e) {
        queueInfo = { enabled: false, error: String(e && e.message ? e.message : e) };
      }
    }

    return res.json({ files: recentFiles, monitors: recentMonitors, queue: queueInfo });
  } catch (err) {
    console.error('[statusController] error', err);
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}

module.exports = { status };
