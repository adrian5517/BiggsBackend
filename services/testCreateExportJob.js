require('dotenv').config()
const mongoose = require('mongoose')
const ExportJob = require('../models/exportJobModel')

async function run() {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/biggs'
  await mongoose.connect(MONGO_URI)
  const job = new ExportJob({ jobId: `test_${Date.now()}`, status: 'pending', params: { q: 'GOTO', branch: 'AYALA-FRN' } })
  await job.save()
  console.log('Created job', job._id, job.jobId)
  await mongoose.disconnect()
}

if (require.main === module) run()
