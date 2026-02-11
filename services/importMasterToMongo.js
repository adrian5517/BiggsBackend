require('dotenv').config()
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const mongoose = require('mongoose')
const MasterTransaction = require('../models/masterTransactionModel')

const MASTER_DIR = path.join(__dirname, '..', 'master')
const INDEX_PATH = path.join(MASTER_DIR, 'index.json')
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/biggs'

async function connect() {
  console.log('Resolved MONGO_URI =', MONGO_URI)
  await mongoose.connect(MONGO_URI)
  console.log('Connected to MongoDB')
}

function readIndex() {
  if (!fs.existsSync(INDEX_PATH)) return { summary: [] }
  return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'))
}

async function importKey(key, batchSize = 1000) {
  const idx = readIndex()
  const found = (idx.summary || []).find(s => s.key === key || s.file === key)
  if (!found) throw new Error('Key not found in index')
  const filePath = path.join(MASTER_DIR, found.file)
  if (!fs.existsSync(filePath)) throw new Error('File not found: ' + filePath)

  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(filePath)
    const gunzip = zlib.createGunzip()
    let leftover = ''
    const batch = []
    let total = 0

    function flushBatch() {
      if (batch.length === 0) return Promise.resolve(0)
      const docs = batch.splice(0, batch.length)
      return MasterTransaction.insertMany(docs, { ordered: false }).then(r => r.length).catch(e => {
        // ignore duplicate errors, report inserted count if available
        if (e && e.insertedCount) return e.insertedCount
        return 0
      })
    }

    gunzip.on('data', async chunk => {
      const s = leftover + chunk.toString()
      const parts = s.split('\n')
      leftover = parts.pop()
      for (const p of parts) {
        if (!p) continue
        try {
          const obj = JSON.parse(p)
          // normalize date if present
          if (obj.date) {
            const d = new Date(obj.date)
            if (!isNaN(d)) obj.date = d
            else delete obj.date
          }
          batch.push(obj)
          if (batch.length >= batchSize) {
            rs.pause()
            await flushBatch()
            total += batchSize
            rs.resume()
          }
        } catch (e) {
          // ignore parse errors
        }
      }
    })

    gunzip.on('end', async () => {
      // handle leftover
      if (leftover) {
        try {
          const obj = JSON.parse(leftover)
          batch.push(obj)
        } catch (e) {}
      }
      const inserted = await flushBatch()
      total = total + inserted
      resolve({ inserted: total })
    })

    gunzip.on('error', err => reject(err))
    rs.on('error', err => reject(err))
    rs.pipe(gunzip)
  })
}

async function run() {
  await connect()
  const args = process.argv.slice(2)
  const key = args[0]
  if (!key) {
    console.error('Usage: node importMasterToMongo.js <key>')
    process.exit(1)
  }
  try {
    console.log('Importing', key)
    const res = await importKey(key)
    console.log('Import result:', res)
  } catch (e) {
    console.error('Import error', e)
  } finally {
    await mongoose.disconnect()
  }
}

if (require.main === module) run()

module.exports = { importKey }
