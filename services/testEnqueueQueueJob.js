const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })
const fs = require('fs')
function ensureEnvVar(key) {
  if (!process.env[key]) {
    try {
      const txt = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8')
      const re = new RegExp('^' + key + '\\s*=\\s*(.*)$', 'm')
      const m = txt.match(re)
      if (m) process.env[key] = m[1].trim()
    } catch (e) {}
  }
}
ensureEnvVar('REDIS_URL')
const exportQueue = require('./exportQueue')

console.log('DEBUG: REDIS_URL=', process.env.REDIS_URL)

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
