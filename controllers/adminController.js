const { runRetention } = require('../services/backupRetention');
const ReportBackup = require('../models/reportBackupModel');
const Report = require('../models/reportModel');
const jobBus = require('../services/jobBus');

exports.getRetentionStatus = async (req, res) => {
  try {
    const enabled = process.env.POS_ENABLE_RETENTION !== 'false';
    const retentionDays = Number(process.env.POS_BACKUP_RETENTION_DAYS || 90);
    const intervalHours = Number(process.env.POS_BACKUP_RETENTION_INTERVAL_HOURS || 24);
    const backupsCount = await ReportBackup.countDocuments();
    return res.json({ enabled, retentionDays, intervalHours, backupsCount });
  } catch (e) {
    return res.status(500).json({ message: e && e.message ? e.message : 'Server error' });
  }
};

exports.runRetention = async (req, res) => {
  try {
    const apply = req.body && req.body.apply === true;
    const retentionDays = req.body && req.body.retentionDays ? Number(req.body.retentionDays) : undefined;

    // Dry-run: return result immediately
    if (!apply) {
      const result = await runRetention({ retentionDays, dryRun: true });
      return res.json({ ok: true, apply: false, ...result });
    }

    // Apply: run in background and emit progress via jobBus
    const jobId = `retention-${Date.now()}`;
    // notify clients that a retention job was queued
    jobBus.emit('progress', { jobId, message: 'Retention apply queued', percent: 0 });
    res.status(202).json({ ok: true, apply: true, jobId, message: 'Retention apply started' });

    (async () => {
      try {
        jobBus.emit('progress', { jobId, message: 'Running retention', percent: 10 });
        const result = await runRetention({ retentionDays, dryRun: false });
        jobBus.emit('progress', { jobId, message: `Deleted ${result.deleted || 0} backups`, percent: 100, result });
        jobBus.emit('complete', { jobId, message: 'Retention apply complete', result });
      } catch (err) {
        jobBus.emit('error', { jobId, message: err && err.message ? err.message : String(err) });
      }
    })();
    return;
  } catch (e) {
    return res.status(500).json({ message: e && e.message ? e.message : 'Server error' });
  }
};

exports.listBackups = async (req, res) => {
  try {
    const { page = 1, limit = 50, branch, workDate } = req.query;
    const q = {};
    if (branch) q.branch = branch;
    if (workDate) q.workDate = new Date(workDate);
    const docs = await ReportBackup.find(q).sort({ replacedAt: -1 }).skip((page - 1) * limit).limit(Number(limit)).lean();
    const total = await ReportBackup.countDocuments(q);
    return res.json({ docs, total, page: Number(page), limit: Number(limit) });
  } catch (e) {
    return res.status(500).json({ message: e && e.message ? e.message : 'Server error' });
  }
};

exports.deleteBackup = async (req, res) => {
  try {
    const { id } = req.params;
    await ReportBackup.findByIdAndDelete(id);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: e && e.message ? e.message : 'Server error' });
  }
};

exports.restoreBackup = async (req, res) => {
  try {
    const { id } = req.params;
    const backup = await ReportBackup.findById(id).lean();
    if (!backup) return res.status(404).json({ message: 'Not found' });

    const jobId = `restore-${Date.now()}`;
    // respond quickly and run restore in background while emitting jobBus events
    res.status(202).json({ ok: true, jobId, message: 'Restore queued' });

    (async () => {
      try {
        jobBus.emit('file-start', { jobId, message: 'Restoring backup', id });
        const doc = {
          jobId: backup.jobId || jobId,
          branch: backup.branch,
          pos: backup.pos,
          workDate: backup.workDate,
          uniqueKey: backup.uniqueKey,
          sourceFile: backup.sourceFile,
          ingestedAt: backup.ingestedAt || new Date(),
          data: backup.data,
        };
        jobBus.emit('progress', { jobId, message: 'Inserting report row', percent: 30, id });
        await Report.create(doc);
        jobBus.emit('file-complete', { jobId, message: 'Restore inserted', id });
        jobBus.emit('complete', { jobId, message: 'Restore complete', id });
      } catch (err) {
        jobBus.emit('error', { jobId, message: err && err.message ? err.message : String(err), id });
      }
    })();
    return;
  } catch (e) {
    return res.status(500).json({ message: e && e.message ? e.message : 'Server error' });
  }
};
