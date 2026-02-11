const mongoose = require('mongoose')

const MonitorEntrySchema = new mongoose.Schema({
  branch: String,
  pos: String,
  date: String,
  note: String,
  createdAt: { type: Date, default: Date.now }
})

module.exports = mongoose.model('MonitorEntry', MonitorEntrySchema)
