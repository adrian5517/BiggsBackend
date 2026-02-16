const bullmq = require('bullmq');
const { getConnectionOptions } = require('./redis');

// handle CJS/ESM interop where bullmq may be default-exported
const Queue = bullmq.Queue || (bullmq.default && bullmq.default.Queue);
const QueueScheduler = bullmq.QueueScheduler || (bullmq.default && bullmq.default.QueueScheduler);

function createQueue(name, opts = {}) {
  const connection = getConnectionOptions();
  // create a scheduler to enable delayed jobs, retries and stalled-job handling
  if (typeof QueueScheduler === 'function') {
    try {
      // start a scheduler (it will manage delayed/retry/stalled jobs)
      new QueueScheduler(name, { connection });
    } catch (err) {
      console.warn('[queue] QueueScheduler start failed:', err && err.message ? err.message : err);
    }
  } else {
    console.warn('[queue] QueueScheduler not available from bullmq; continuing without a scheduler.');
  }

  if (typeof Queue !== 'function') {
    throw new Error('BullMQ Queue class not available from bullmq import');
  }

  const queue = new Queue(name, Object.assign({ connection }, opts));
  return queue;
}

module.exports = {
  createQueue,
};
// end
