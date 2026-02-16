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
ensureEnvVar('MONGO_URI')
if (String(process.env.ENABLE_MONGO).toLowerCase() !== 'true') {
  console.error('ENABLE_MONGO!=true — testExportMasterCsvGz requires MongoDB. Set ENABLE_MONGO=true to run.');
  process.exit(1);
}
const zlib = require('zlib')
let mongoose = null;
if (String(process.env.ENABLE_MONGO).toLowerCase() === 'true') {
  try { mongoose = require('mongoose') } catch (e) { mongoose = null }
}
const masterCtrl = require('../controllers/masterController')

async function run() {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/biggs'
  console.log('Resolved MONGO_URI =', MONGO_URI)
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
