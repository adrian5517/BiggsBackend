const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })
const fs = require('fs')
// fallback parser for .env entries that may have unusual spacing
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
ensureEnvVar('MONGO_URI')
const mongoose = require('mongoose')
const ExportJob = require('../models/exportJobModel')

console.log('DEBUG: MONGO_URI=', process.env.MONGO_URI)

async function run() {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/biggs'
  console.log('Resolved MONGO_URI =', MONGO_URI)
  await mongoose.connect(MONGO_URI)
  const job = new ExportJob({ jobId: `test_${Date.now()}`, status: 'pending', params: { q: 'GOTO', branch: 'AYALA-FRN' } })
  await job.save()
  console.log('Created job', job._id, job.jobId)
  await mongoose.disconnect()
}

if (require.main === module) run()
