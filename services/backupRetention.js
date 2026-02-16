const ReportBackup = require('../models/reportBackupModel');

/**
 * Delete ReportBackup documents older than retentionDays.
 * @param {Object} opts
 * @param {number} opts.retentionDays - days to keep (default read from POS_BACKUP_RETENTION_DAYS or 90)
 * @param {boolean} opts.dryRun - if true, only count matching documents and do not delete (default true)
 * @returns {Promise<{matched:number,deleted?:number,cutoff:Date}>}
 */
async function runRetention({ retentionDays, dryRun } = {}) {
  const days = Number(retentionDays || process.env.POS_BACKUP_RETENTION_DAYS || 90);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const q = { createdAt: { $lt: cutoff } };
  const matched = await ReportBackup.countDocuments(q);
  if (dryRun) return { matched, cutoff };
  const res = await ReportBackup.deleteMany(q);
  return { matched, deleted: res.deletedCount || 0, cutoff };
}

/**
 * Schedule periodic retention runs. Returns an object with stop() to cancel.
 * @param {Object} opts
 * @param {number} opts.intervalMs - ms between runs (default 24h)
 * @param {number} opts.retentionDays - days to keep
 */
function scheduleRetention({ intervalMs = 24 * 60 * 60 * 1000, retentionDays } = {}) {
  let running = false;
  const runner = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runRetention({ retentionDays, dryRun: false });
      console.log('backupRetention: cleaned', r.deleted, 'backups older than', r.cutoff.toISOString());
    } catch (e) {
      console.error('backupRetention: error', e && e.message ? e.message : e);
    } finally {
      running = false;
    }
  };

  const id = setInterval(runner, intervalMs);
  return {
    stop() {
      clearInterval(id);
    },
  };
}

module.exports = { runRetention, scheduleRetention };
