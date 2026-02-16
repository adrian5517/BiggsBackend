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
  console.error('ENABLE_MONGO!=true — testMasterSearch requires MongoDB. Set ENABLE_MONGO=true to run.');
  process.exit(1);
}
let mongoose = null;
try { mongoose = require('mongoose') } catch (e) { mongoose = null }
const masterCtrl = require('../controllers/masterController')

async function run() {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/biggs'
    console.log('DEBUG: MONGO_URI=', process.env.MONGO_URI)
  console.log('Resolved MONGO_URI =', MONGO_URI)
  await mongoose.connect(MONGO_URI)
  console.log('Connected to Mongo for test search')
  try {
    const res = await masterCtrl.searchTransactions({ q: 'GOTO', branch: 'AYALA-FRN', page: 1, limit: 5 })
    console.log('Search result:', res.total, 'items:', res.items.length)
    console.dir(res.items.slice(0,3), { depth: 2 })
  } catch (e) {
    console.error('Search error', e)
  } finally {
    await mongoose.disconnect()
  }
}

if (require.main === module) run()
