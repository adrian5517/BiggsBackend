require('dotenv').config()
const exportQueue = require('./exportQueue')

async function run() {
  if (!process.env.REDIS_URL && !process.env.REDIS) {
    console.error('Set REDIS_URL to enqueue test job')
    process.exit(1)
  }
  try {
    const job = await exportQueue.enqueueExportJob({ q: 'GOTO', branch: 'AYALA-FRN' }, null)
    console.log('Enqueued job:', job._id.toString())
  } catch (e) {
    console.error('Enqueue failed', e.message)
  }
}

if (require.main === module) run()
