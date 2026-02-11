require('dotenv').config()
const fs = require('fs')
const zlib = require('zlib')
const mongoose = require('mongoose')
const masterCtrl = require('../controllers/masterController')

async function run() {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/biggs'
  await mongoose.connect(MONGO_URI)
  console.log('Connected to Mongo for gz export test')
  const outPath = 'master-export-test.csv.gz'
  const out = fs.createWriteStream(outPath)
  const gzip = zlib.createGzip()
  gzip.pipe(out)
  try {
    await masterCtrl.streamSearchCsvToStream({ branch: 'AYALA-FRN', q: 'GOTO' }, gzip)
    gzip.end()
    // wait for file to finish writing
    await new Promise((res, rej) => out.on('close', res).on('error', rej))
    console.log('Gz export finished —', outPath)

    // quick verification: read and print first 5 lines
    const buf = fs.readFileSync(outPath)
    const decompressed = zlib.gunzipSync(buf).toString('utf8')
    const lines = decompressed.split('\n').slice(0, 6)
    console.log('Preview:')
    lines.forEach(l => console.log(l))
  } catch (e) {
    console.error('Gz export error', e)
  } finally {
    await mongoose.disconnect()
  }
}

if (require.main === module) run()
