exports.health = async (req, res) => {
  const checks = {
    node: true,
    mongo: false,
    redis: false,
  };
  try {
    const mongoose = require('mongoose');
    checks.mongo = mongoose.connection.readyState === 1;
  } catch (e) {
    checks.mongo = false;
  }

  try {
    const { Queue } = require('bullmq');
    const REDIS_URL = process.env.REDIS_URL || process.env.REDIS || null;
    checks.redis = !!REDIS_URL;
    if (checks.redis) {
      const q = new Queue('importQueue', { connection: { url: REDIS_URL } });
      const counts = await q.getJobCounts();
      await q.close();
      checks.queue = counts;
    }
  } catch (e) {
    checks.redis = false;
  }

  res.json({ ok: checks.node && (checks.mongo || false), checks });
};
