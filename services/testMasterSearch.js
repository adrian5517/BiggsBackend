require('dotenv').config()
const mongoose = require('mongoose')
const masterCtrl = require('../controllers/masterController')

async function run() {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/biggs'
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
