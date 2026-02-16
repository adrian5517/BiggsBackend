const path = require('path')
const fs = require('fs')
// load repo .env if present
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') })
let mongoose = null;
if (String(process.env.ENABLE_MONGO).toLowerCase() === 'true') {
  try { mongoose = require('mongoose') } catch (e) { mongoose = null }
}
const { buildLookups } = require('../combiner/lookupBuilder')
const { processRd5000 } = require('../combiner/streamParser')

const MasterRecord = require('../../models/masterRecordModel')
const FileRecord = require('../../models/fileRecordModel')
const MonitorEntry = require('../../models/monitorEntryModel')

async function ensureConnected() {
  if (String(process.env.ENABLE_MONGO).toLowerCase() !== 'true') {
    throw new Error('MongoDB disabled (ENABLE_MONGO!=true) — worker actions that require MongoDB are unavailable')
  }
  if (mongoose.connection.readyState === 1) return
  const uri = process.env.MONGO_URI
  if (!uri) throw new Error('MONGO_URI not set')
  await mongoose.connect(uri)
}

function basenameNoExt(fn) {
  return path.basename(fn, path.extname(fn))
}

async function processFolder(folder) {
  await ensureConnected()
  const abs = path.resolve(folder)
  if (!fs.existsSync(abs)) throw new Error('folder not found: ' + abs)

  const lookups = await buildLookups(abs)
  const files = fs.readdirSync(abs).filter(f => f.toLowerCase().includes('rd5000'))
  let totalInserted = 0

  for (const f of files) {
    const full = path.join(abs, f)
    // create or update FileRecord
    const fr = await FileRecord.findOneAndUpdate({ filename: f }, { filename: f, status: 'parsing', fetchedAt: new Date() }, { upsert: true, returnDocument: 'after' })

    // try to extract date from filename (pattern _YYYY-MM-DD_ or YYYY-MM-DD)
    const dateMatch = f.match(/(\d{4}-\d{2}-\d{2})/)
    const fileDate = dateMatch ? dateMatch[1] : null

    console.log('Processing file', f, 'fileDate=', fileDate)

    try {
      await processRd5000(full, lookups, async (batch) => {
        // Convert to MasterRecord docs structure
        const docs = batch.map(r => ({
          branch: (f.split('_')[1] || '').toUpperCase(),
          pos: String(r.pos || ''),
          date: r.date ? new Date(r.date) : null,
          time: r.time,
          or: r.or,
          item_code: r.item_code,
          qty: r.qty,
          unit_price: r.unit_price,
          amount: r.amount,
          discount_code: r.discount_code,
          discount_name: r.discount_name,
          dept_code: r.dept_code,
          dept_name: r.dept_name,
          product_name: r.product_name,
          transaction_type: r.transaction_type,
          payment_code: r.payment_code,
          payment_name: r.payment_name,
          phone: r.phone,
          source_file: r.source_file
        }))

        try {
          const res = await MasterRecord.insertMany(docs, { ordered: false })
          totalInserted += res.length
          console.log('Inserted batch size=', res.length, 'totalInserted=', totalInserted)
        } catch (err) {
          console.error('insertMany error (continuing):', err.message)
        }
      }, { batchSize: 1000 })

      // mark file as parsed
      fr.status = 'parsed'
      await fr.save()

      // validate dates
      if (fileDate) {
        const mismatchCount = await MasterRecord.countDocuments({ source_file: full, date: { $ne: new Date(fileDate) } })
        if (mismatchCount > 0) {
          await MonitorEntry.create({ branch: fr.branch, pos: fr.pos, date: fileDate, note: `date mismatch rows=${mismatchCount} for ${f}` })
        }
      }
    } catch (err) {
      console.error('Error processing file', f, err)
      fr.status = 'error'
      fr.error = err.message
      await fr.save()
    }
  }

  console.log('Processing complete for folder', abs, 'totalInserted=', totalInserted)
  return totalInserted
}

module.exports = { processFolder }
