require('dotenv').config()
const fs = require('fs')
const mongoose = require('mongoose')
const masterCtrl = require('../controllers/masterController')

async function run() {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/biggs'
  await mongoose.connect(MONGO_URI)
  console.log('Connected to Mongo for CSV export test')
  const out = fs.createWriteStream('master-export-test.csv')
  try {
    await masterCtrl.streamSearchCsvToStream({ branch: 'AYALA-FRN', q: 'GOTO' }, out)
    console.log('Export finished')
  } catch (e) {
    console.error('Export error', e)
  } finally {
    await mongoose.disconnect()
  }
}

if (require.main === module) run()
